//! Private application authorization for gateway-forwarded LiveKit signaling.

use axum::{
    Router,
    extract::State,
    http::{HeaderMap, StatusCode, Uri, header},
    routing::get,
};

use super::rooms::CallRooms;
use crate::features::accounts::AccountError;

const FORWARDED_URI: &str = "x-forwarded-uri";
const MAX_TOKEN_BYTES: usize = 4096;

/// Mount the private authorization route used before forwarding a provider handshake.
pub(crate) fn router(rooms: CallRooms) -> Router {
    Router::new().route("/internal/calls/signaling", get(admit)).with_state(rooms)
}

async fn admit(
    State(rooms): State<CallRooms>,
    headers: HeaderMap,
) -> (StatusCode, [(header::HeaderName, &'static str); 1]) {
    let status = match signaling_token(&headers) {
        Some(token) => match rooms.authorize_signaling(&token).await {
            Ok(()) => StatusCode::NO_CONTENT,
            Err(AccountError::Unavailable) => StatusCode::SERVICE_UNAVAILABLE,
            Err(_) => StatusCode::FORBIDDEN,
        },
        None => StatusCode::FORBIDDEN,
    };

    (status, [(header::CACHE_CONTROL, "no-store")])
}

fn signaling_token(headers: &HeaderMap) -> Option<String> {
    // Caddy supplies the original URI to its internal auth subrequest.
    let mut forwarded = headers.get_all(FORWARDED_URI).iter();
    let header = forwarded.next()?.to_str().ok()?;
    let original = header.parse::<Uri>().ok()?;
    if forwarded.next().is_some() || original.authority().is_some() {
        return None;
    }
    if original.path() != "/rtc" && !original.path().starts_with("/rtc/") {
        return None;
    }

    let query = original.query()?;
    let mut tokens = url::form_urlencoded::parse(query.as_bytes());
    let token = tokens.find(|(name, _)| name == "access_token")?.1;
    if token.is_empty() || token.len() > MAX_TOKEN_BYTES {
        return None;
    }
    if tokens.any(|(name, _)| name == "access_token") {
        return None;
    }

    Some(token.into_owned())
}
