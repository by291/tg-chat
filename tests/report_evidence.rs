#[allow(dead_code)]
mod support;

use std::time::Duration;

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
        AccountService, Actor, Registration, SessionGrant,
        http::{self, AccountHttpState},
        transport::HttpSettings,
    },
    media::{AttachmentInput, MediaCleanup},
    messages::{MessageService, SendReceipt},
};
use tokio::{
    sync::oneshot,
    time::{sleep, timeout},
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

async fn report_message(
    fixture: &ReportFixture,
    message_id: Uuid,
    operation_id: Uuid,
) -> (StatusCode, Value) {
    let path = format!("/api/v1/messages/{message_id}/reports");
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

async fn report(fixture: &ReportFixture, operation_id: Uuid) -> (StatusCode, Value) {
    report_message(fixture, fixture.sent.message.id, operation_id).await
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

struct OriginalFixture {
    report: ReportFixture,
    operator: CaseBrowser,
    sender: Actor,
    service: MessageService,
    file_id: Uuid,
    occurrence_id: Uuid,
}

async fn original_fixture(pool: &PgPool) -> OriginalFixture {
    let (accounts, queue, _) = support::services(pool.clone());
    let sender = support::account(&accounts, "original_sender").await;
    let reporter = register(&accounts, "original_reporter").await;
    let operator = register(&accounts, "case_reviewer").await;
    let set_operator = sqlx::query("UPDATE users SET is_operator = true WHERE id = $1");
    set_operator.bind(operator.user.id).execute(pool).await.unwrap();

    let file_id = support::media::prepared_document(pool, &sender).await;
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

    let operator = CaseBrowser {
        router,
        cookie: operator_cookie.split(';').next().unwrap().to_owned(),
    };

    OriginalFixture {
        report: fixture,
        operator,
        sender,
        service,
        file_id,
        occurrence_id,
    }
}

fn source_removal(sent: &SendReceipt) -> tg_chat::messages::MessageCommand {
    support::messaging::command(
        sent.conversation.id,
        json!({"kind": "delete", "message_id": sent.message.id}),
    )
}

fn original_path(receipt: &Value, occurrence_id: Uuid) -> String {
    let case_id = receipt["case_id"].as_str().unwrap();

    format!("/api/v1/operator/cases/{case_id}/attachments/{occurrence_id}")
}

impl OriginalFixture {
    async fn assert_original(&self, path: &str) {
        let original = self.operator.get(path).await;
        assert_eq!(original.status(), StatusCode::OK);
        assert_eq!(original.headers()["x-content-type-options"], "nosniff");
        let bytes = original.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(bytes.as_ref(), b"a private document");
    }
}

async fn blocked_backend(pool: &PgPool, blocker: i32) -> i32 {
    const LOCK_WAIT_TIMEOUT: Duration = Duration::from_secs(10);
    const LOCK_POLL_INTERVAL: Duration = Duration::from_millis(10);

    timeout(LOCK_WAIT_TIMEOUT, async {
        loop {
            let query = sqlx::query_scalar(
                "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
            );
            if let Some(waiter) = query.bind(blocker).fetch_optional(pool).await.unwrap() {
                return waiter;
            }

            sleep(LOCK_POLL_INTERVAL).await;
        }
    })
    .await
    .expect("the competing database operation did not block")
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and RustFS"]
async fn report_and_source_removal_resolve_under_the_same_file_locks(pool: PgPool) {
    let fixture = original_fixture(&pool).await;
    let mut file_lock = pool.begin().await.unwrap();
    let blocker: i32 =
        sqlx::query_scalar("SELECT pg_backend_pid()").fetch_one(&mut *file_lock).await.unwrap();
    let lock = sqlx::query("SELECT id FROM media_files WHERE id = $1 FOR UPDATE");
    lock.bind(fixture.file_id).execute(&mut *file_lock).await.unwrap();

    let operation_id = Uuid::new_v4();
    let admission = report(&fixture.report, operation_id);
    let (start_removal, wait_to_remove) = oneshot::channel();
    let removal = async {
        wait_to_remove.await.unwrap();
        fixture.service.command(fixture.sender.clone(), source_removal(&fixture.report.sent)).await
    };
    let release = async {
        // The report holds the source conversation while it waits for the original file.
        let reporting_backend = blocked_backend(&pool, blocker).await;
        start_removal.send(()).unwrap();
        blocked_backend(&pool, reporting_backend).await;
        file_lock.commit().await.unwrap();
    };
    let ((status, receipt), removed, ()) = tokio::join!(admission, removal, release);
    assert_eq!(status, StatusCode::OK, "{receipt}");
    removed.unwrap();

    let message_id = fixture.report.sent.message.id;
    let remaining = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM media_message_references WHERE message_id = $1)",
    );
    assert!(!remaining.bind(message_id).fetch_one(&pool).await.unwrap());

    let case_id = receipt["case_id"].as_str().unwrap();
    let case_path = format!("/api/v1/operator/cases/{case_id}");
    let detail = fixture.operator.get(&case_path).await;
    assert_eq!(detail.status(), StatusCode::OK);
    let body = detail.into_body().collect().await.unwrap().to_bytes();
    let detail: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(detail["evidence"]["message_text"], "Original text");
    assert_eq!(detail["attachments"].as_array().unwrap().len(), 1);
    assert_eq!(detail["attachments"][0]["occurrence_id"], fixture.occurrence_id.to_string());
    fixture.assert_original(&original_path(&receipt, fixture.occurrence_id)).await;
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and RustFS"]
async fn expired_case_releases_only_its_own_references(pool: PgPool) {
    let fixture = original_fixture(&pool).await;
    let (status, receipt) = report(&fixture.report, Uuid::new_v4()).await;
    assert_eq!(status, StatusCode::OK, "{receipt}");
    let case_id = receipt["case_id"].as_str().unwrap();
    let case_uuid = Uuid::parse_str(case_id).unwrap();
    let path = original_path(&receipt, fixture.occurrence_id);

    let second_occurrence = Uuid::new_v4();
    let mut input = support::messaging::send_input(fixture.report.reporter_id);
    input.attachments.push(AttachmentInput {
        file_id: fixture.file_id,
        occurrence_id: second_occurrence,
    });
    let second = fixture.service.send(fixture.sender.clone(), input).await.unwrap();
    let (status, second_receipt) =
        report_message(&fixture.report, second.message.id, Uuid::new_v4()).await;
    assert_eq!(status, StatusCode::OK, "{second_receipt}");
    let second_path = original_path(&second_receipt, second_occurrence);
    let wrong_case = original_path(&second_receipt, fixture.occurrence_id);
    assert_eq!(fixture.operator.get(&wrong_case).await.status(), StatusCode::NOT_FOUND);

    for sent in [&fixture.report.sent, &second] {
        fixture.service.command(fixture.sender.clone(), source_removal(sent)).await.unwrap();
    }
    let collector = MediaCleanup::new(pool.clone(), support::media::storage_settings());
    collector.process_next().await.unwrap();

    let ordinary_browser = CaseBrowser {
        router: fixture.report.router.clone(),
        cookie: fixture.report.cookie.clone(),
    };
    assert_eq!(ordinary_browser.get(&path).await.status(), StatusCode::FORBIDDEN);
    fixture.assert_original(&path).await;

    let expire = sqlx::query(
        "UPDATE moderation_cases SET created_at = clock_timestamp() - interval '91 days',
         evidence_expires_at = clock_timestamp() - interval '1 day' WHERE id = $1",
    );
    expire.bind(case_uuid).execute(&pool).await.unwrap();
    assert_eq!(fixture.operator.get(&path).await.status(), StatusCode::NOT_FOUND);
    assert!(tg_chat::moderation::evidence::expire_one(&pool).await.unwrap());
    let remains = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM media_evidence_references WHERE case_id = $1)",
    );
    assert!(!remains.bind(case_uuid).fetch_one(&pool).await.unwrap());
    fixture.assert_original(&second_path).await;
}
