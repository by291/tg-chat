use std::collections::HashMap;

use axum::{Router, body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tg_chat::{
    config::ServiceKind,
    features::{
        accounts::mail::{MailQueue, MailSettings},
        accounts::{
            AccountService, AccountSettings, http::AccountHttpState, transport::HttpSettings,
        },
    },
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
    let mail = MailQueue::new(pool.clone(), MailSettings::from_values(&values).unwrap()).unwrap();
    let account_routes =
        tg_chat::features::accounts::http::router(AccountHttpState::new(accounts, settings, mail));

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

#[sqlx::test]
#[ignore = "requires PostgreSQL and Valkey"]
async fn messaging_replay_preserves_identity_and_requires_session_csrf(pool: PgPool) {
    let application = application(pool.clone(), &valkey_url());
    let (_, cookie, grant) = send(
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
    let cookie = cookie.unwrap();
    let csrf = grant["csrf_token"].as_str().unwrap();
    let message = json!({
        "operation_id": Uuid::new_v4(),
        "message_id": Uuid::new_v4(),
        "destination": { "kind": "saved" },
        "content": {
            "schema_version": 1,
            "text": "Durable HTTP message",
            "rich_text": null,
            "custom_emoji": [],
        },
    });
    let (status, _, _) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/messages",
            origin: Some(ORIGIN),
            cookie: Some(&cookie),
            csrf: None,
            body: message.clone(),
        },
    )
    .await;
    assert_eq!(status, 403);
    let (status, _, first) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/messages",
            origin: Some(ORIGIN),
            cookie: Some(&cookie),
            csrf: Some(csrf),
            body: message.clone(),
        },
    )
    .await;
    assert_eq!(status, 200, "{first}");
    let (status, _, replay) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/messages",
            origin: Some(ORIGIN),
            cookie: Some(&cookie),
            csrf: Some(csrf),
            body: message,
        },
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(first, replay);
    let path = format!("/api/v1/messages/{}", first["message"]["id"].as_str().unwrap());
    let (status, _, fetched) = send(
        &application,
        TestRequest {
            method: "GET",
            path: &path,
            origin: None,
            cookie: Some(&cookie),
            csrf: None,
            body: Value::Null,
        },
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(fetched, first["message"]);
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM messages").fetch_one(&pool).await.unwrap();
    assert_eq!(count, 1);

    let mut edit = json!({
        "operation_id": Uuid::new_v4(),
        "conversation_id": first["conversation"]["id"],
        "action": {
            "kind": "edit",
            "message_id": first["message"]["id"],
            "expected_version": "1",
            "content": {
                "schema_version": 1,
                "text": "Edited through HTTP",
                "custom_emoji": []
            }
        }
    });
    let (status, _, _) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/chat/commands",
            origin: Some(ORIGIN),
            cookie: Some(&cookie),
            csrf: Some(csrf),
            body: edit.clone(),
        },
    )
    .await;
    assert_eq!(status, 200);
    edit["operation_id"] = json!(Uuid::new_v4());
    let (status, _, conflict) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/chat/commands",
            origin: Some(ORIGIN),
            cookie: Some(&cookie),
            csrf: Some(csrf),
            body: edit,
        },
    )
    .await;
    assert_eq!(status, 409);
    assert_eq!(conflict["current"]["message"]["version"], "2");
    assert_eq!(conflict["error"]["code"], "message_conflict");
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and Valkey"]
async fn community_routes_require_session_csrf_and_server_owned_roles(pool: PgPool) {
    let application = application(pool, &valkey_url());
    let (_, cookie, grant) = send(
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
    let cookie = cookie.unwrap();
    let csrf = grant["csrf_token"].as_str().unwrap();
    let id = Uuid::new_v4();
    let input = json!({
        "operation_id": Uuid::new_v4(),
        "conversation_id": id,
        "kind": "group",
        "title": "HTTP community",
        "description": "Authenticated community",
        "public_handle": "http_group",
        "is_public": true,
        "requires_approval": false
    });
    let (denied, _, _) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/communities",
            origin: Some(ORIGIN),
            cookie: Some(&cookie),
            csrf: None,
            body: input.clone(),
        },
    )
    .await;
    assert_eq!(denied, 403);
    let (accepted, _, receipt) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/communities",
            origin: Some(ORIGIN),
            cookie: Some(&cookie),
            csrf: Some(csrf),
            body: input,
        },
    )
    .await;
    assert_eq!(accepted, 200, "{receipt}");
    assert_eq!(receipt["conversation"]["role"], "owner");
    let (anonymous, _, _) = send(
        &application,
        TestRequest {
            method: "GET",
            path: &format!("/api/v1/communities/{id}"),
            origin: Some(ORIGIN),
            cookie: None,
            csrf: None,
            body: Value::Null,
        },
    )
    .await;
    assert_eq!(anonymous, 401);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn media_reservation_requires_csrf_even_when_disabled(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let registration = serde_json::from_value(registration()).unwrap();
    let grant = accounts.register(registration).await.unwrap();
    let settings = HttpSettings::from_values(&HashMap::new()).unwrap();
    let cookie = settings.session_cookie(&grant.token);
    let application = application(pool, &valkey_url());

    let (status, _, _) = send(
        &application,
        TestRequest {
            method: "POST",
            path: "/api/v1/media/uploads",
            origin: Some(ORIGIN),
            cookie: Some(&cookie),
            csrf: None,
            body: json!({}),
        },
    )
    .await;

    assert_eq!(status, 403);
}
