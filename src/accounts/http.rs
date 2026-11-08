use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

use super::{
    AccountError, AccountService, Login, PasswordChange, PrivateProfile, Registration,
    RevokeSession, SessionGrant, SessionView,
    email::EmailService,
    extractors::{ActorContext, ApiFailure, PublicContext, SafeJson},
    rate_limit::RateLimiter,
    transport::HttpSettings,
};

const MAX_BODY_BYTES: usize = 16 * 1024;

#[derive(Clone)]
pub struct AccountHttpState {
    pub(crate) accounts: AccountService,
    pub(crate) settings: HttpSettings,
    pub(crate) limiter: RateLimiter,
    pub(crate) email: EmailService,
}

#[derive(Serialize, ToSchema)]
struct AuthResponse {
    user: PrivateProfile,
    session: SessionView,
    csrf_token: String,
}

#[derive(Serialize, ToSchema)]
struct Capabilities {
    registration_open: bool,
    email_recovery_available: bool,
    avatars_available: bool,
    messaging_available: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct PasswordProof {
    password: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct PasswordReplacement {
    current_password: String,
    new_password: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct DeviceRevocation {
    session_id: Uuid,
}

#[derive(OpenApi)]
#[openapi(paths(
    capabilities,
    register,
    login,
    session,
    logout,
    reauthenticate,
    change_password,
    devices,
    revoke_device,
    revoke_other_devices,
    profile
))]
pub struct AccountDocument;

impl AccountHttpState {
    /// Combine account transactions with browser transport and sensitive admission limits.
    pub fn new(
        accounts: AccountService,
        settings: HttpSettings,
        mail: crate::jobs::MailQueue,
    ) -> Self {
        let limiter = RateLimiter::new(&settings);
        let email = EmailService::new(accounts.clone(), mail);

        Self {
            accounts,
            settings,
            limiter,
            email,
        }
    }
}

fn session_response(state: &AccountHttpState, grant: SessionGrant, status: StatusCode) -> Response {
    let cookie = state.settings.session_cookie(&grant.token);
    let payload = AuthResponse {
        user: grant.user,
        session: grant.session,
        csrf_token: grant.csrf_token,
    };
    let mut response = (status, Json(payload)).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).expect("valid cookie"));

    response
}

fn logged_out_response(state: &AccountHttpState) -> Response {
    let cookie = state.settings.removal_cookie();
    let mut response = StatusCode::NO_CONTENT.into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).expect("valid cookie"));

    response
}

#[utoipa::path(
    get,
    path = "/api/v1/capabilities",
    responses((status = 200, body = Capabilities))
)]
async fn capabilities(
    State(state): State<AccountHttpState>,
    context: PublicContext,
) -> Result<Json<Capabilities>, ApiFailure> {
    let registration_open =
        sqlx::query_scalar("SELECT is_open FROM registration_policy WHERE singleton")
            .fetch_one(&state.accounts.pool)
            .await
            .map_err(|error| context.failure(error.into()))?;

    Ok(Json(Capabilities {
        registration_open,
        email_recovery_available: state.email.is_enabled(),
        avatars_available: false,
        messaging_available: true,
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/register",
    request_body = Registration,
    responses((status = 201, body = AuthResponse))
)]
async fn register(
    State(state): State<AccountHttpState>,
    context: PublicContext,
    SafeJson(input): SafeJson<Registration>,
) -> Result<Response, ApiFailure> {
    state
        .limiter
        .admit("register", &context.client, &input.username.to_ascii_lowercase())
        .await
        .map_err(|error| context.failure(error))?;
    let grant = state.accounts.register(input).await.map_err(|error| context.failure(error))?;

    Ok(session_response(&state, grant, StatusCode::CREATED))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/login",
    request_body = Login,
    responses((status = 200, body = AuthResponse))
)]
async fn login(
    State(state): State<AccountHttpState>,
    context: PublicContext,
    SafeJson(input): SafeJson<Login>,
) -> Result<Response, ApiFailure> {
    state
        .limiter
        .admit("login", &context.client, &input.username.to_ascii_lowercase())
        .await
        .map_err(|error| context.failure(error))?;
    let grant = state.accounts.login(input).await.map_err(|error| context.failure(error))?;

    Ok(session_response(&state, grant, StatusCode::OK))
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/session",
    responses((status = 200, body = AuthResponse))
)]
async fn session(
    State(state): State<AccountHttpState>,
    context: ActorContext,
) -> Result<Json<AuthResponse>, ApiFailure> {
    let user = state
        .accounts
        .profile(&context.actor)
        .await
        .map_err(|error| context.request.failure(error))?;
    let sessions = state
        .accounts
        .list_sessions(&context.actor)
        .await
        .map_err(|error| context.request.failure(error))?;
    let session = sessions
        .into_iter()
        .find(|session| session.is_current)
        .ok_or_else(|| context.request.failure(AccountError::Unauthenticated))?;

    Ok(Json(AuthResponse {
        user,
        session,
        csrf_token: context.csrf_token,
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/logout",
    responses((status = 204))
)]
async fn logout(
    State(state): State<AccountHttpState>,
    context: ActorContext,
) -> Result<Response, ApiFailure> {
    state
        .accounts
        .revoke_session(RevokeSession {
            session_id: context.actor.session_id,
            actor: context.actor.clone(),
        })
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(logged_out_response(&state))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/reauthenticate",
    request_body = PasswordProof,
    responses((status = 204))
)]
async fn reauthenticate(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<PasswordProof>,
) -> Result<StatusCode, ApiFailure> {
    state
        .limiter
        .admit("password", &context.request.client, &context.actor.user_id.to_string())
        .await
        .map_err(|error| context.request.failure(error))?;
    state
        .accounts
        .reauthenticate(&context.actor, input.password)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/account/password",
    request_body = PasswordReplacement,
    responses((status = 200, body = AuthResponse))
)]
async fn change_password(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<PasswordReplacement>,
) -> Result<Response, ApiFailure> {
    state
        .limiter
        .admit("password", &context.request.client, &context.actor.user_id.to_string())
        .await
        .map_err(|error| context.request.failure(error))?;
    let grant = state
        .accounts
        .change_password(PasswordChange {
            actor: context.actor.clone(),
            current_password: input.current_password,
            new_password: input.new_password,
        })
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(session_response(&state, grant, StatusCode::OK))
}

#[utoipa::path(
    get,
    path = "/api/v1/account/devices",
    responses((status = 200, body = [SessionView]))
)]
async fn devices(
    State(state): State<AccountHttpState>,
    context: ActorContext,
) -> Result<Json<Vec<SessionView>>, ApiFailure> {
    let sessions = state
        .accounts
        .list_sessions(&context.actor)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(sessions))
}

#[utoipa::path(
    post,
    path = "/api/v1/account/devices/revoke",
    request_body = DeviceRevocation,
    responses((status = 204))
)]
async fn revoke_device(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<DeviceRevocation>,
) -> Result<Response, ApiFailure> {
    state
        .accounts
        .revoke_session(RevokeSession {
            actor: context.actor.clone(),
            session_id: input.session_id,
        })
        .await
        .map_err(|error| context.request.failure(error))?;
    if input.session_id == context.actor.session_id {
        return Ok(logged_out_response(&state));
    }

    Ok(StatusCode::NO_CONTENT.into_response())
}

#[utoipa::path(
    post,
    path = "/api/v1/account/devices/revoke-others",
    responses((status = 204))
)]
async fn revoke_other_devices(
    State(state): State<AccountHttpState>,
    context: ActorContext,
) -> Result<StatusCode, ApiFailure> {
    state
        .accounts
        .revoke_other_sessions(&context.actor)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/account/profile",
    responses((status = 200, body = PrivateProfile))
)]
async fn profile(
    State(state): State<AccountHttpState>,
    context: ActorContext,
) -> Result<Json<PrivateProfile>, ApiFailure> {
    let profile = state
        .accounts
        .profile(&context.actor)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(profile))
}

async fn prevent_caching(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let mut response = next.run(request).await;
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    response
}

/// Build account routes with bounded bodies and no browser or intermediary caching.
pub fn router(state: AccountHttpState) -> Router {
    let routes = Router::new()
        .route("/capabilities", get(capabilities))
        .route("/auth/register", post(register));
    let routes = routes.route("/auth/login", post(login)).route("/auth/session", get(session));
    let routes = routes
        .route("/auth/logout", post(logout))
        .route("/auth/reauthenticate", post(reauthenticate));
    let routes = routes
        .route("/account/password", post(change_password))
        .route("/account/profile", get(profile));
    let routes = routes
        .route("/account/devices", get(devices))
        .route("/account/devices/revoke", post(revoke_device));
    let routes = routes.route("/account/devices/revoke-others", post(revoke_other_devices));
    let routes = routes.merge(crate::contacts::http::router());
    let routes = routes.merge(super::email_http::router());
    let routes = routes.layer(DefaultBodyLimit::max(MAX_BODY_BYTES));
    let routes = routes.merge(crate::messages::http::router());
    let routes = routes.layer(axum::middleware::from_fn(prevent_caching));

    Router::new().nest("/api/v1", routes).with_state(state)
}
