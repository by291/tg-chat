#[allow(dead_code)]
mod support;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tg_chat::{
    accounts::{
        AccountService, Registration, SessionGrant,
        http::{self, AccountHttpState},
        transport::HttpSettings,
    },
    media::{AttachmentInput, MediaCleanup},
    messages::{MessageService, SendReceipt},
};
use tower::ServiceExt;
use uuid::Uuid;

struct ReportFixture {
    router: Router,
    cookie: String,
    csrf_token: String,
    sent: SendReceipt,
    reporter_id: Uuid,
}

async fn register(accounts: &AccountService, username: &str) -> SessionGrant {
    accounts
        .register(Registration {
            username: username.to_owned(),
            display_name: username.to_owned(),
            password: "a complete password phrase".to_owned(),
            device_name: "Report browser".to_owned(),
        })
        .await
        .unwrap()
}

async fn fixture(pool: PgPool) -> ReportFixture {
    let (accounts, queue, _) = support::services(pool);
    let sender = support::account(&accounts, "evidence_sender").await;
    let reporter = register(&accounts, "evidence_reporter").await;
    let service = MessageService::new(accounts.clone());
    let input = support::messaging::send_input(reporter.user.id);
    let sent = service.send(sender, input).await.unwrap();

    let settings = HttpSettings::from_values(&Default::default()).unwrap();
    let cookie = settings.session_cookie(&reporter.token);
    let router = http::router(AccountHttpState::new(accounts, settings, queue));

    ReportFixture {
        router,
        cookie: cookie.split(';').next().unwrap().to_owned(),
        csrf_token: reporter.csrf_token,
        sent,
        reporter_id: reporter.user.id,
    }
}

async fn report(fixture: &ReportFixture, operation_id: Uuid) -> (StatusCode, Value) {
    let path = format!("/api/v1/messages/{}/reports", fixture.sent.message.id);
    let payload = json!({
        "operation_id": operation_id,
        "reason": "spam",
        "note": "An unsolicited message.",
    });
    let request = Request::post(path)
        .header("content-type", "application/json")
        .header("origin", "http://localhost:8080")
        .header("x-tg-chat-request", "1")
        .header("x-csrf-token", &fixture.csrf_token)
        .header("cookie", &fixture.cookie)
        .body(Body::from(payload.to_string()))
        .unwrap();
    let response = fixture.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();

    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn duplicate_reports_preserve_the_original_case_and_deadline(pool: PgPool) {
    let fixture = fixture(pool.clone()).await;
    let operation_id = Uuid::new_v4();

    let (status, receipt) = report(&fixture, operation_id).await;
    assert_eq!(status, StatusCode::OK, "{receipt}");
    assert!(receipt["case_id"].as_str().is_some());
    assert!(receipt["evidence_expires_at"].as_str().is_some());
    let (status, replay) = report(&fixture, operation_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replay, receipt);
    let (status, duplicate) = report(&fixture, Uuid::new_v4()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(duplicate, receipt);

    let deadline: chrono::TimeDelta = sqlx::query_scalar(
        "SELECT extract(epoch FROM evidence_expires_at - created_at)::bigint
         FROM moderation_cases",
    )
    .fetch_one(&pool)
    .await
    .map(chrono::TimeDelta::seconds)
    .unwrap();
    assert_eq!(deadline, chrono::TimeDelta::days(90));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn reporters_cannot_capture_hidden_expired_or_quarantined_sources(pool: PgPool) {
    let fixture = fixture(pool.clone()).await;
    let message_id = fixture.sent.message.id;
    let conversation_id = fixture.sent.conversation.id;

    let hidden = sqlx::query("INSERT INTO hidden_messages (user_id, message_id) VALUES ($1, $2)");
    hidden.bind(fixture.reporter_id).bind(message_id).execute(&pool).await.unwrap();
    assert_eq!(report(&fixture, Uuid::new_v4()).await.0, StatusCode::NOT_FOUND);
    sqlx::query("DELETE FROM hidden_messages").execute(&pool).await.unwrap();

    let expire = sqlx::query("UPDATE messages SET expires_at = now() WHERE id = $1");
    expire.bind(message_id).execute(&pool).await.unwrap();
    assert_eq!(report(&fixture, Uuid::new_v4()).await.0, StatusCode::NOT_FOUND);
    let clear_expiry = sqlx::query("UPDATE messages SET expires_at = NULL WHERE id = $1");
    clear_expiry.bind(message_id).execute(&pool).await.unwrap();

    let quarantine = sqlx::query("UPDATE conversations SET is_quarantined = true WHERE id = $1");
    quarantine.bind(conversation_id).execute(&pool).await.unwrap();
    assert_eq!(report(&fixture, Uuid::new_v4()).await.0, StatusCode::NOT_FOUND);
}

struct CaseBrowser {
    router: Router,
    cookie: String,
}

impl CaseBrowser {
    async fn get(&self, path: &str) -> axum::response::Response {
        let request = Request::get(path).header("cookie", &self.cookie);
        let request = request.body(Body::empty()).unwrap();
        self.router.clone().oneshot(request).await.unwrap()
    }
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and RustFS"]
async fn expired_case_denies_original_download_and_releases_its_reference(pool: PgPool) {
    let (accounts, queue, _) = support::services(pool.clone());
    let sender = support::account(&accounts, "original_sender").await;
    let reporter = register(&accounts, "original_reporter").await;
    let operator = register(&accounts, "case_reviewer").await;
    let set_operator = sqlx::query("UPDATE users SET is_operator = true WHERE id = $1");
    set_operator.bind(operator.user.id).execute(&pool).await.unwrap();

    let file_id = support::media::prepared_document(&pool, &sender).await;
    let occurrence_id = Uuid::new_v4();
    let service = MessageService::new(accounts.clone());
    let mut input = support::messaging::send_input(reporter.user.id);
    input.attachments.push(AttachmentInput {
        file_id,
        occurrence_id,
    });
    let sent = service.send(sender.clone(), input).await.unwrap();

    let settings = HttpSettings::from_values(&Default::default()).unwrap();
    let reporter_cookie = settings.session_cookie(&reporter.token);
    let operator_cookie = settings.session_cookie(&operator.token);
    let state = AccountHttpState::new(accounts.clone(), settings, queue);
    let media = support::media::test_upload_service(accounts);
    let router = http::router(state.with_media(media));
    let fixture = ReportFixture {
        router: router.clone(),
        cookie: reporter_cookie.split(';').next().unwrap().to_owned(),
        csrf_token: reporter.csrf_token,
        sent,
        reporter_id: reporter.user.id,
    };

    let (status, receipt) = report(&fixture, Uuid::new_v4()).await;
    assert_eq!(status, StatusCode::OK, "{receipt}");
    let case_id = receipt["case_id"].as_str().unwrap();
    let case_uuid = Uuid::parse_str(case_id).unwrap();
    let path = format!("/api/v1/operator/cases/{case_id}/attachments/{occurrence_id}");
    let remove = support::messaging::command(
        fixture.sent.conversation.id,
        json!({"kind": "delete", "message_id": fixture.sent.message.id}),
    );
    service.command(sender, remove).await.unwrap();
    let collector = MediaCleanup::new(pool.clone(), support::media::storage_settings());
    collector.process_next().await.unwrap();

    let ordinary_browser = CaseBrowser {
        router: router.clone(),
        cookie: fixture.cookie,
    };
    assert_eq!(ordinary_browser.get(&path).await.status(), StatusCode::FORBIDDEN);
    let operator_browser = CaseBrowser {
        router,
        cookie: operator_cookie.split(';').next().unwrap().to_owned(),
    };
    let original = operator_browser.get(&path).await;
    assert_eq!(original.status(), StatusCode::OK);
    assert_eq!(original.headers()["x-content-type-options"], "nosniff");
    let bytes = original.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(bytes.as_ref(), b"a private document");

    let expire = sqlx::query(
        "UPDATE moderation_cases SET created_at = clock_timestamp() - interval '91 days',
         evidence_expires_at = clock_timestamp() - interval '1 day' WHERE id = $1",
    );
    expire.bind(case_uuid).execute(&pool).await.unwrap();
    assert_eq!(operator_browser.get(&path).await.status(), StatusCode::NOT_FOUND);
    assert!(tg_chat::moderation::evidence::expire_one(&pool).await.unwrap());
    let remains = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM media_evidence_references WHERE case_id = $1)",
    );
    assert!(!remains.bind(case_uuid).fetch_one(&pool).await.unwrap());
}
