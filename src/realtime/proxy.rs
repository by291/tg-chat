use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::post,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use super::RealtimeSettings;
use crate::accounts::{AccountError, AccountService, Actor, extractors::session_token};

const REFRESH_SECONDS: i64 = 60;
const REGISTRY_SECONDS: i64 = 120;
const MAX_PROXY_BODY_BYTES: usize = 16 * 1024;

#[derive(Clone)]
struct ProxyState {
    accounts: AccountService,
    settings: RealtimeSettings,
}

#[derive(Deserialize)]
struct ProxyInput {
    client: Uuid,
    user: Option<Uuid>,
}

fn authorize_proxy(headers: &HeaderMap, settings: &RealtimeSettings) -> Result<(), StatusCode> {
    let supplied = headers.get("x-tg-proxy-key").map(|value| value.as_bytes()).unwrap_or_default();
    let is_trusted = bool::from(supplied.ct_eq(settings.proxy_key.as_bytes()));
    if !is_trusted {
        return Err(StatusCode::FORBIDDEN);
    }

    Ok(())
}

fn denied() -> Json<Value> {
    Json(json!({
        "disconnect": {
            "code": 4501,
            "reason": "unauthorized"
        }
    }))
}

async fn connect(
    State(state): State<ProxyState>,
    headers: HeaderMap,
    Json(input): Json<ProxyInput>,
) -> Result<Json<Value>, StatusCode> {
    authorize_proxy(&headers, &state.settings)?;
    let origin = headers.get("origin").and_then(|value| value.to_str().ok());
    if origin != Some(state.settings.transport.origin.as_str()) {
        return Err(StatusCode::FORBIDDEN);
    }
    let Some(token) = session_token(&headers, state.settings.transport.cookie_name()) else {
        return Ok(denied());
    };
    let actor = match state.accounts.authenticate(&token).await {
        Ok(actor) => actor,
        Err(AccountError::Unauthenticated) => return Ok(denied()),
        Err(_) => return Err(StatusCode::SERVICE_UNAVAILABLE),
    };
    let insert = sqlx::query(
        "INSERT INTO realtime_connections (client_id, user_id, session_id, expires_at)
         SELECT $1, user_id, id, now() + $3 * interval '1 second' FROM sessions
         WHERE id = $2 AND revoked_at IS NULL AND expires_at > now()
         ON CONFLICT (client_id) DO NOTHING",
    )
    .bind(input.client)
    .bind(actor.session_id)
    .bind(REGISTRY_SECONDS);
    let inserted =
        insert.execute(&state.accounts.pool).await.map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if inserted.rows_affected() != 1 {
        return Ok(denied());
    }
    let channel = format!("personal:{}", actor.user_id);
    let subscriptions = json!({channel: {}});

    Ok(Json(json!({
        "result": {
            "user": actor.user_id,
            "expire_at": Utc::now().timestamp() + REFRESH_SECONDS,
            "subs": subscriptions,
            "meta": {"session_id": actor.session_id}
        }
    })))
}

async fn refresh(
    State(state): State<ProxyState>,
    headers: HeaderMap,
    Json(input): Json<ProxyInput>,
) -> Result<Json<Value>, StatusCode> {
    authorize_proxy(&headers, &state.settings)?;
    // Use the registry created during connect, never client-supplied refresh metadata.
    let actor = sqlx::query_as::<_, Actor>(
        "SELECT user_id, session_id FROM realtime_connections
         WHERE client_id = $1 AND user_id = $2 AND expires_at > now()",
    )
    .bind(input.client)
    .bind(input.user);
    let actor = actor
        .fetch_optional(&state.accounts.pool)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let Some(actor) = actor else {
        return Ok(Json(json!({"result": {"expired": true}})));
    };
    let mut connection =
        state.accounts.pool.acquire().await.map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let validity = crate::messages::service::verify_actor(
        &mut connection,
        &actor,
        state.accounts.settings.idle_days,
    )
    .await;
    match validity {
        Ok(()) => {}
        Err(AccountError::Unauthenticated) => {
            return Ok(Json(json!({"result": {"expired": true}})));
        }
        Err(_) => return Err(StatusCode::SERVICE_UNAVAILABLE),
    }
    sqlx::query("UPDATE realtime_connections SET expires_at = now() + $2 * interval '1 second' WHERE client_id = $1")
        .bind(input.client).bind(REGISTRY_SECONDS).execute(&mut *connection).await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;

    Ok(Json(json!({"result": {"expire_at": Utc::now().timestamp() + REFRESH_SECONDS}})))
}

/// Expose secret-authenticated internal proxies outside the public cookie/CSRF API routes.
pub fn router(accounts: AccountService, settings: RealtimeSettings) -> Router {
    let routes = Router::new()
        .route("/internal/realtime/connect", post(connect))
        .route("/internal/realtime/refresh", post(refresh));

    routes.layer(DefaultBodyLimit::max(MAX_PROXY_BODY_BYTES)).with_state(ProxyState {
        accounts,
        settings,
    })
}
