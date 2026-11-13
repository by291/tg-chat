use std::collections::HashMap;

use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tg_chat::features::{
    accounts::{AccountService, AccountSettings, Registration},
    realtime::{RealtimeSettings, router},
};
use tower::ServiceExt;
use uuid::Uuid;

const PROXY_SECRET: &str = "proxy-test-key-with-at-least-thirty-two-characters";
const ORIGIN: &str = "http://localhost:8080";

struct ProxyRequest<'a> {
    path: &'a str,
    secret: &'a str,
    origin: &'a str,
    cookie: &'a str,
    body: Value,
}

async fn invoke(router: &axum::Router, input: ProxyRequest<'_>) -> (u16, Value) {
    let request = Request::post(input.path).header("content-type", "application/json");
    let request = request.header("x-tg-proxy-key", input.secret).header("origin", input.origin);
    let request =
        request.header("cookie", input.cookie).body(Body::from(input.body.to_string())).unwrap();
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();

    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn connect_uses_cookie_identity_and_refresh_rejects_revoked_sessions(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let grant = accounts
        .register(Registration {
            username: "alice".to_owned(),
            password: "a complete password phrase".to_owned(),
            display_name: "Alice".to_owned(),
            device_name: "Browser".to_owned(),
        })
        .await
        .unwrap();
    let actor = accounts.authenticate(&grant.token).await.unwrap();
    let mut values = HashMap::new();
    values.insert("TG_CHAT_CENTRIFUGO_PROXY_KEY".to_owned(), PROXY_SECRET.to_owned());
    values.insert("TG_CHAT_CENTRIFUGO_API_KEY".to_owned(), PROXY_SECRET.to_owned());
    let settings = RealtimeSettings::from_values(&values).unwrap().unwrap();
    let application = router(accounts, settings);
    let cookie = format!("tg_chat_session={}", grant.token);
    let client = Uuid::new_v4();
    let request = json!({"client": client, "data": {"user": Uuid::new_v4()}});
    let (status, _) = invoke(
        &application,
        ProxyRequest {
            path: "/internal/realtime/connect",
            secret: "wrong",
            origin: ORIGIN,
            cookie: &cookie,
            body: request.clone(),
        },
    )
    .await;
    assert_eq!(status, 403);
    let (status, _) = invoke(
        &application,
        ProxyRequest {
            path: "/internal/realtime/connect",
            secret: PROXY_SECRET,
            origin: "https://foreign.example",
            cookie: &cookie,
            body: request.clone(),
        },
    )
    .await;
    assert_eq!(status, 403);
    let (status, connected) = invoke(
        &application,
        ProxyRequest {
            path: "/internal/realtime/connect",
            secret: PROXY_SECRET,
            origin: ORIGIN,
            cookie: &cookie,
            body: request,
        },
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(connected["result"]["user"], actor.user_id.to_string());
    let channel = format!("personal:{}", actor.user_id);
    assert!(connected["result"]["subs"].get(channel).is_some());
    let refresh =
        json!({"client": client, "user": actor.user_id, "meta": connected["result"]["meta"]});
    sqlx::query("UPDATE sessions SET revoked_at = now() WHERE id = $1")
        .bind(actor.session_id)
        .execute(&pool)
        .await
        .unwrap();
    let (_, refreshed) = invoke(
        &application,
        ProxyRequest {
            path: "/internal/realtime/refresh",
            secret: PROXY_SECRET,
            origin: ORIGIN,
            cookie: "",
            body: refresh,
        },
    )
    .await;
    assert_eq!(refreshed["result"]["expired"], true);
}
