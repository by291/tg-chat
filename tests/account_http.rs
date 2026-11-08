use std::collections::HashMap;

use axum::{Router, body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tg_chat::{
    accounts::{AccountService, AccountSettings, http::AccountHttpState, transport::HttpSettings},
    config::ServiceKind,
    http::{ApplicationState, router_with_api},
};
use tower::ServiceExt;
use uuid::Uuid;

const ORIGIN: &str = "http://localhost:8080";

struct TestRequest<'request> {
    method: &'request str,
    path: &'request str,
    origin: Option<&'request str>,
    cookie: Option<&'request str>,
    csrf: Option<&'request str>,
    body: Value,
}

fn valkey_url() -> String {
    std::env::var("TG_CHAT_TEST_VALKEY_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:65408".to_owned())
}

fn application(pool: PgPool, valkey_url: &str) -> Router {
    let mut values = HashMap::new();
    values.insert("TG_CHAT_VALKEY_URL".to_owned(), valkey_url.to_owned());
    values.insert("TG_CHAT_RATE_NAMESPACE".to_owned(), Uuid::new_v4().to_string());
    let settings = HttpSettings::from_values(&values).unwrap();
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let account_routes = tg_chat::accounts::http::router(AccountHttpState::new(accounts, settings));

    router_with_api(
        ApplicationState {
            pool,
            service: ServiceKind::Api,
        },
        account_routes,
    )
}

async fn send(application: &Router, input: TestRequest<'_>) -> (u16, Option<String>, Value) {
    let mut request = Request::builder().method(input.method).uri(input.path);
    request = request.header("content-type", "application/json");
    if let Some(origin) = input.origin {
        request = request.header("origin", origin).header("x-tg-chat-request", "1");
    }
    if let Some(cookie) = input.cookie {
        let cookie_pair = cookie.split(';').next().unwrap();
        request = request.header("cookie", cookie_pair);
    }
    if let Some(csrf) = input.csrf {
        request = request.header("x-csrf-token", csrf);
    }
    let request = request.body(Body::from(input.body.to_string())).unwrap();
    let response = application.clone().oneshot(request).await.unwrap();
    let status = response.status().as_u16();
    let cookie =
        response.headers().get("set-cookie").map(|value| value.to_str().unwrap().to_owned());
    assert!(response.headers().contains_key("x-request-id"));
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let payload = serde_json::from_slice(&body).unwrap_or(Value::Null);

    (status, cookie, payload)
}

fn registration() -> Value {
    json!({
        "username": "alice",
        "password": "a complete password phrase",
        "display_name": "Alice",
        "device_name": "Browser",
    })
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and Valkey"]
async fn cookies_and_csrf_protect_mutations_and_logout_revokes_reads(pool: PgPool) {
    let application = application(pool, &valkey_url());
    let (status, _, _) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/auth/register",
            origin: Some("https://untrusted.example"),
            cookie: None,
            csrf: None,
            body: registration(),
        },
    )
    .await;
    assert_eq!(status, 403);

    let (status, cookie, payload) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/auth/register",
            origin: Some(ORIGIN),
            cookie: None,
            csrf: None,
            body: registration(),
        },
    )
    .await;
    assert_eq!(status, 201, "{payload}");
    let cookie = cookie.unwrap();
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Lax"));
    assert!(!cookie.contains("Secure"));
    assert!(payload.get("token").is_none());
    let csrf = payload["csrf_token"].as_str().unwrap();

    let (status, _, _) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/auth/logout",
            origin: Some(ORIGIN),
            cookie: Some(&cookie),
            csrf: None,
            body: Value::Null,
        },
    )
    .await;
    assert_eq!(status, 403);
    let (status, _, _) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/auth/logout",
            origin: Some(ORIGIN),
            cookie: Some(&cookie),
            csrf: Some(csrf),
            body: Value::Null,
        },
    )
    .await;
    assert_eq!(status, 204);
    let (status, _, _) = send(
        &application,
        TestRequest {
            method: "GET",
            path: "/api/v1/auth/session",
            origin: None,
            cookie: Some(&cookie),
            csrf: None,
            body: Value::Null,
        },
    )
    .await;
    assert_eq!(status, 401);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and Valkey"]
async fn admission_rejects_malformed_json_closed_registration_and_rate_exhaustion(pool: PgPool) {
    let application = application(pool.clone(), &valkey_url());
    let (status, _, payload) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/auth/register",
            origin: Some(ORIGIN),
            cookie: None,
            csrf: None,
            body: json!({"password": "not a registration"}),
        },
    )
    .await;
    assert_eq!(status, 400);
    assert!(payload["error"]["request_id"].is_string());

    sqlx::query("UPDATE registration_policy SET is_open = false").execute(&pool).await.unwrap();
    let (status, _, payload) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/auth/register",
            origin: Some(ORIGIN),
            cookie: None,
            csrf: None,
            body: registration(),
        },
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(payload["error"]["code"], "registration_closed");

    let mut final_status = 0;
    for _ in 0..12 {
        let (status, _, _) = send(
            &application,
            TestRequest {
                method: "POST",
                path: "/api/v1/auth/login",
                origin: Some(ORIGIN),
                cookie: None,
                csrf: None,
                body: json!({
                    "username": "absent",
                    "password": "a complete password phrase",
                    "device_name": "Browser",
                }),
            },
        )
        .await;
        final_status = status;
    }
    assert_eq!(final_status, 429);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn unavailable_limiter_rejects_admission_but_keeps_authenticated_reads(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let grant = accounts.register(serde_json::from_value(registration()).unwrap()).await.unwrap();
    let application = application(pool, "redis://127.0.0.1:1");
    let (status, _, _) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/auth/login",
            origin: Some(ORIGIN),
            cookie: None,
            csrf: None,
            body: json!({
                "username": "alice",
                "password": "a complete password phrase",
                "device_name": "Browser",
            }),
        },
    )
    .await;
    assert_eq!(status, 503);

    let cookie = format!("tg_chat_session={}", grant.token);
    let (status, _, payload) = send(
        &application,
        TestRequest {
            method: "GET",
            path: "/api/v1/auth/session",
            origin: None,
            cookie: Some(&cookie),
            csrf: None,
            body: Value::Null,
        },
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(payload["user"]["username"], "alice");
}

#[test]
fn cookie_configuration_rejects_insecure_public_origins() {
    let mut values = HashMap::new();
    values.insert("TG_CHAT_PUBLIC_ORIGIN".to_owned(), "http://chat.example".to_owned());
    assert!(HttpSettings::from_values(&values).is_err());
    values.insert("TG_CHAT_PUBLIC_ORIGIN".to_owned(), "https://chat.example/path".to_owned());
    assert!(HttpSettings::from_values(&values).is_err());
    values.insert("TG_CHAT_PUBLIC_ORIGIN".to_owned(), "https://chat.example".to_owned());
    let settings = HttpSettings::from_values(&values).unwrap();
    assert!(settings.session_cookie("secret").contains("Secure"));
}
