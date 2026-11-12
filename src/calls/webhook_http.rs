//! Private LiveKit callback transport.

use axum::{
    Router,
    body::Bytes,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode, header},
    routing::post,
};
use sqlx::PgPool;

use crate::accounts::AccountError;

use super::{
    livekit::LiveKit,
    webhook::{ReceiveWebhook, receive},
};

const MAX_WEBHOOK_BYTES: usize = 64 * 1024;

#[derive(Clone)]
struct Callback {
    pool: PgPool,
    provider: LiveKit,
}

/// Receive signed callbacks from the provider's private network.
pub(crate) fn router(pool: PgPool, provider: LiveKit) -> Router {
    let callback = Callback {
        pool,
        provider,
    };
    let router = Router::new().route("/internal/livekit/webhook", post(webhook));

    router.layer(DefaultBodyLimit::max(MAX_WEBHOOK_BYTES)).with_state(callback)
}

async fn webhook(State(callback): State<Callback>, headers: HeaderMap, body: Bytes) -> StatusCode {
    let mut authorization = headers.get_all(header::AUTHORIZATION).iter();
    let Some(token) = authorization.next().and_then(|header| header.to_str().ok()) else {
        return StatusCode::FORBIDDEN;
    };
    if authorization.next().is_some() {
        return StatusCode::FORBIDDEN;
    }

    let Ok(body) = std::str::from_utf8(&body) else {
        return StatusCode::BAD_REQUEST;
    };

    // Verify the original UTF-8 bytes so JSON normalization cannot change the signed body.
    let input = ReceiveWebhook {
        pool: &callback.pool,
        provider: &callback.provider,
        body,
        token: token.strip_prefix("Bearer ").unwrap_or(token),
    };
    match receive(input).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(AccountError::Forbidden) => StatusCode::FORBIDDEN,
        Err(AccountError::Validation(_)) => StatusCode::BAD_REQUEST,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}
