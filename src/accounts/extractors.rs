use std::net::{IpAddr, SocketAddr};

use axum::{
    Json,
    extract::{ConnectInfo, FromRequest, FromRequestParts, Request},
    http::{HeaderMap, Method, StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use cookie::Cookie;
use serde::de::DeserializeOwned;
use subtle::ConstantTimeEq;

use super::{AccountError, Actor, credentials::csrf_token, http::AccountHttpState};
use crate::http::{ErrorDetails, RequestId, error_response};

pub(crate) struct ApiFailure {
    error: AccountError,
    request_id: String,
}

pub(crate) struct PublicContext {
    pub request_id: String,
    pub client: String,
}

pub(crate) struct ActorContext {
    pub actor: Actor,
    pub request: PublicContext,
    pub csrf_token: String,
}

pub(crate) struct SafeJson<T>(pub T);

impl PublicContext {
    /// Attach a safe account error to the server-owned correlation ID.
    pub fn failure(&self, error: AccountError) -> ApiFailure {
        ApiFailure {
            error,
            request_id: self.request_id.clone(),
        }
    }
}

impl IntoResponse for ApiFailure {
    fn into_response(self) -> Response {
        let (status, code) = match &self.error {
            AccountError::Validation(_) => (StatusCode::BAD_REQUEST, "invalid_request"),
            AccountError::UsernameUnavailable => (StatusCode::CONFLICT, "username_unavailable"),
            AccountError::InvalidCredentials => (StatusCode::UNAUTHORIZED, "invalid_credentials"),
            AccountError::Unauthenticated => (StatusCode::UNAUTHORIZED, "unauthenticated"),
            AccountError::RecentAuthenticationRequired => {
                (StatusCode::FORBIDDEN, "recent_authentication_required")
            }
            AccountError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            AccountError::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
            AccountError::MessageConflict => (StatusCode::CONFLICT, "message_conflict"),
            AccountError::ConversationUnavailable => {
                (StatusCode::CONFLICT, "conversation_unavailable")
            }
            AccountError::SyncResetRequired => (StatusCode::CONFLICT, "sync_reset_required"),
            AccountError::Conflict => (StatusCode::CONFLICT, "account_changed"),
            AccountError::QuotaExceeded => (StatusCode::CONFLICT, "capacity_reached"),
            AccountError::Unavailable => {
                (StatusCode::SERVICE_UNAVAILABLE, "dependency_unavailable")
            }
            AccountError::RegistrationClosed => (StatusCode::FORBIDDEN, "registration_closed"),
            AccountError::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "rate_limited"),
            AccountError::EmailUnavailable => {
                (StatusCode::SERVICE_UNAVAILABLE, "email_unavailable")
            }
            AccountError::EmailUnavailableForAccount => {
                (StatusCode::CONFLICT, "email_unavailable_for_account")
            }
            AccountError::InvalidChallenge => (StatusCode::BAD_REQUEST, "invalid_challenge"),
        };

        error_response(
            status,
            ErrorDetails {
                code,
                message: self.error.to_string(),
                request_id: self.request_id,
            },
        )
    }
}

fn request_id(parts: &Parts) -> String {
    parts.extensions.get::<RequestId>().map(|identifier| identifier.0.clone()).unwrap_or_default()
}

fn client_address(parts: &Parts, state: &AccountHttpState) -> String {
    if state.settings.should_trust_gateway {
        // This mode is only for a private API listener whose gateway overwrites this header.
        let forwarded = parts.headers.get("x-tg-client-ip").and_then(|value| value.to_str().ok());
        if let Some(address) = forwarded.and_then(|value| value.parse::<IpAddr>().ok()) {
            return address.to_string();
        }
    }

    parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|address| address.0.ip().to_string())
        .unwrap_or_else(|| "unknown".to_owned())
}

fn is_unsafe(method: &Method) -> bool {
    !matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

impl FromRequestParts<AccountHttpState> for PublicContext {
    type Rejection = ApiFailure;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AccountHttpState,
    ) -> Result<Self, Self::Rejection> {
        let context = Self {
            request_id: request_id(parts),
            client: client_address(parts, state),
        };
        if !is_unsafe(&parts.method) {
            return Ok(context);
        }

        let origin = parts.headers.get("origin").and_then(|value| value.to_str().ok());
        let request_marker = parts.headers.get("x-tg-chat-request");
        let has_valid_marker = request_marker.is_some_and(|value| value == "1");
        if origin != Some(state.settings.origin.as_str()) || !has_valid_marker {
            return Err(context.failure(AccountError::Forbidden));
        }

        Ok(context)
    }
}

/// Extract exactly one named session cookie, rejecting ambiguous duplicate credentials.
pub(crate) fn session_token(headers: &HeaderMap, name: &str) -> Option<String> {
    let mut token = None;
    for header in headers.get_all("cookie") {
        let encoded = header.to_str().ok()?;
        for cookie in Cookie::split_parse(encoded) {
            let cookie = cookie.ok()?;
            if cookie.name() != name {
                continue;
            }
            // Ambiguous duplicate cookies must never choose an attacker-controlled first value.
            if token.is_some() {
                return None;
            }
            token = Some(cookie.value().to_owned());
        }
    }

    token
}

impl FromRequestParts<AccountHttpState> for ActorContext {
    type Rejection = ApiFailure;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AccountHttpState,
    ) -> Result<Self, Self::Rejection> {
        let context = PublicContext::from_request_parts(parts, state).await?;
        let token = session_token(&parts.headers, state.settings.cookie_name())
            .ok_or_else(|| context.failure(AccountError::Unauthenticated))?;
        let actor =
            state.accounts.authenticate(&token).await.map_err(|error| context.failure(error))?;
        let csrf_token = csrf_token(&token);
        if is_unsafe(&parts.method) {
            let provided =
                parts.headers.get("x-csrf-token").map(|value| value.as_bytes()).unwrap_or_default();
            let is_valid = bool::from(csrf_token.as_bytes().ct_eq(provided));
            if !is_valid {
                return Err(context.failure(AccountError::Forbidden));
            }
        }

        Ok(Self {
            actor,
            request: context,
            csrf_token,
        })
    }
}

impl<T> FromRequest<AccountHttpState> for SafeJson<T>
where
    T: DeserializeOwned + Send,
{
    type Rejection = ApiFailure;

    async fn from_request(
        request: Request,
        state: &AccountHttpState,
    ) -> Result<Self, Self::Rejection> {
        let identifier = request
            .extensions()
            .get::<RequestId>()
            .map(|identifier| identifier.0.clone())
            .unwrap_or_default();
        let parsed = Json::<T>::from_request(request, state).await;
        let Json(payload) = parsed.map_err(|_| ApiFailure {
            error: AccountError::Validation("a valid JSON request body is required"),
            request_id: identifier,
        })?;

        Ok(Self(payload))
    }
}

pub(crate) struct SafeQuery<T>(pub T);

impl<T> FromRequestParts<AccountHttpState> for SafeQuery<T>
where
    T: DeserializeOwned + Send,
{
    type Rejection = ApiFailure;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AccountHttpState,
    ) -> Result<Self, Self::Rejection> {
        let identifier = request_id(parts);
        let parsed = axum::extract::Query::<T>::from_request_parts(parts, state).await;
        let axum::extract::Query(parameters) = parsed.map_err(|_| ApiFailure {
            error: AccountError::Validation("invalid query parameters"),
            request_id: identifier,
        })?;

        Ok(Self(parameters))
    }
}
