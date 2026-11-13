#[allow(dead_code)]
mod support;

use std::{collections::HashMap, time::Duration};

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tg_chat::features::{
    accounts::{
        AccountError, AccountService, AccountSettings, Login, Registration, SessionGrant,
        email::PasswordReset,
        http::AccountHttpState,
        operator::{OperatorCreation, PolicyChange, RegistrationPolicy},
        transport::HttpSettings,
    },
    conversations::{CommunityAction, CommunityCommand, CommunitySettings, CreateCommunity},
    messages::MessageService,
};
use tokio::time::{sleep, timeout};
use tower::ServiceExt;
use uuid::Uuid;

const COMMAND_PATH: &str = "/api/v1/operator/commands";
const BROWSER_ORIGIN: &str = "http://localhost:8080";
const OPERATOR_PASSWORD: &str = "operator initial password";
const LOCK_OBSERVATION_TIMEOUT: Duration = Duration::from_secs(10);
const LOCK_POLL_INTERVAL: Duration = Duration::from_millis(10);

async fn login_operator(accounts: &AccountService) -> SessionGrant {
    accounts
        .create_operator(OperatorCreation {
            username: "admin".to_owned(),
            password: OPERATOR_PASSWORD.to_owned(),
            display_name: "Operator".to_owned(),
        })
        .await
        .unwrap();
    accounts
        .login(Login {
            username: "admin".to_owned(),
            password: OPERATOR_PASSWORD.to_owned(),
            device_name: "Browser".to_owned(),
        })
        .await
        .unwrap()
}

fn application(accounts: AccountService, pool: PgPool) -> Router {
    let settings = HttpSettings::from_values(&HashMap::new()).unwrap();
    let mail = support::mail_queue(pool);
    tg_chat::features::accounts::http::router(AccountHttpState::new(accounts, settings, mail))
}

async fn command(
    application: &Router,
    grant: &SessionGrant,
    payload: Value,
) -> (StatusCode, Value) {
    let request = Request::post(COMMAND_PATH)
        .header("content-type", "application/json")
        .header("origin", BROWSER_ORIGIN)
        .header("x-tg-chat-request", "1");
    let request = request
        .header("cookie", format!("tg_chat_session={}", grant.token))
        .header("x-csrf-token", &grant.csrf_token)
        .body(Body::from(payload.to_string()))
        .unwrap();
    let response = application.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();

    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

async fn wait_for_blocked_request(pool: &PgPool, blocker: i32) {
    timeout(LOCK_OBSERVATION_TIMEOUT, async {
        loop {
            let is_blocked: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                 WHERE $1 = ANY(pg_blocking_pids(pid)))",
            )
            .bind(blocker)
            .fetch_one(pool)
            .await
            .unwrap();
            if is_blocked {
                return;
            }

            sleep(LOCK_POLL_INTERVAL).await;
        }
    })
    .await
    .expect("operator command did not wait on the target row");
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn operator_action_rechecks_authority_after_target_wait(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let operator = login_operator(&accounts).await;
    let target = support::account(&accounts, "alice").await;
    let application = application(accounts, pool.clone());
    let mut target_lock = pool.begin().await.unwrap();
    let blocker: i32 =
        sqlx::query_scalar("SELECT pg_backend_pid()").fetch_one(&mut *target_lock).await.unwrap();
    let lock = sqlx::query("SELECT id FROM users WHERE id = $1 FOR UPDATE").bind(target.user_id);
    lock.execute(&mut *target_lock).await.unwrap();

    // Let the real recent-authentication window close while the operation waits.
    const REMAINING_WINDOW: Duration = Duration::from_secs(3);
    let age = sqlx::query(
        "UPDATE sessions SET authenticated_at = clock_timestamp() - interval '9 minutes 57 seconds'
         WHERE id = $1",
    )
    .bind(operator.session.id);
    age.execute(&pool).await.unwrap();
    let payload = json!({
        "operation_id": Uuid::new_v4(),
        "reason": "reviewed an abuse report",
        "action": {"kind": "set_suspension", "user_id": target.user_id, "is_suspended": true}
    });
    let response = command(&application, &operator, payload);
    tokio::pin!(response);
    tokio::select! {
        outcome = &mut response => {
            panic!("command completed before target lock was released: {outcome:?}");
        }
        () = wait_for_blocked_request(&pool, blocker) => {}
    }

    // Keep polling the request while the session's clock crosses the boundary.
    tokio::select! {
        outcome = &mut response => {
            panic!("command completed before target lock was released: {outcome:?}");
        }
        () = sleep(REMAINING_WINDOW) => {}
    }
    target_lock.commit().await.unwrap();
    let (status, body) = response.await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["error"]["code"], "recent_authentication_required");

    let is_suspended: bool = sqlx::query_scalar("SELECT is_suspended FROM users WHERE id = $1")
        .bind(target.user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!is_suspended);
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM operator_audit WHERE target_user_id = $1")
            .bind(target.user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn browser_operator_replay_preserves_one_audit_and_matches_trusted_cli(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let operator = login_operator(&accounts).await;
    let application = application(accounts.clone(), pool.clone());
    let operation_id = Uuid::new_v4();
    let payload = json!({
        "operation_id": operation_id,
        "reason": "maintenance",
        "action": {"kind": "set_registration", "is_open": false}
    });

    let (first_status, body) = command(&application, &operator, payload.clone()).await;
    assert_eq!(first_status, StatusCode::NO_CONTENT, "{body}");
    let (replayed_status, body) = command(&application, &operator, payload.clone()).await;
    assert_eq!(replayed_status, StatusCode::NO_CONTENT, "{body}");

    let mut collision = payload;
    collision["action"]["is_open"] = json!(true);
    let (collision_status, body) = command(&application, &operator, collision).await;
    assert_eq!(collision_status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "operation_conflict");

    let is_open: bool =
        sqlx::query_scalar("SELECT is_open FROM registration_policy WHERE singleton")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!is_open);

    accounts
        .set_registration_policy(PolicyChange {
            policy: RegistrationPolicy::Closed,
            reason: "maintenance".to_owned(),
        })
        .await
        .unwrap();

    let audit = sqlx::query_as::<_, (String, Option<Uuid>, String, String, String)>(
        "SELECT actor, actor_user_id, target_kind, reason, outcome FROM operator_audit
         WHERE action = 'registration_closed' ORDER BY actor",
    );
    let audit = audit.fetch_all(&pool).await.unwrap();
    assert_eq!(
        audit,
        vec![
            (
                "browser".to_owned(),
                Some(operator.user.id),
                "registration".to_owned(),
                "maintenance".to_owned(),
                "succeeded".to_owned(),
            ),
            (
                "trusted_cli".to_owned(),
                None,
                "registration".to_owned(),
                "maintenance".to_owned(),
                "succeeded".to_owned(),
            ),
        ]
    );
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn suspended_account_needs_new_login_after_restoration(pool: PgPool) {
    let (accounts, queue, email) = support::services(pool.clone());
    let operator = login_operator(&accounts).await;
    let sender = support::account(&accounts, "sender").await;
    let target = accounts
        .register(Registration {
            username: "alice".to_owned(),
            password: "a complete password phrase".to_owned(),
            display_name: "Alice".to_owned(),
            device_name: "Browser".to_owned(),
        })
        .await
        .unwrap();
    let target_actor = accounts.authenticate(&target.token).await.unwrap();
    email.request_verification(&target_actor, "alice@example.test".to_owned()).await.unwrap();
    email.confirm(support::mailed_token(&queue).await).await.unwrap();
    email.request_recovery("alice@example.test".to_owned()).await.unwrap();
    let recovery = support::mailed_token(&queue).await;
    email.request_verification(&target_actor, "new@example.test".to_owned()).await.unwrap();
    let verification = support::mailed_token(&queue).await;

    let messages = MessageService::new(accounts.clone());
    let original = support::messaging::send_input(target.user.id);
    let shared = messages.send(sender.clone(), original).await.unwrap();
    let community_id = Uuid::new_v4();
    let community = CreateCommunity {
        operation_id: Uuid::new_v4(),
        conversation_id: community_id,
        kind: "group".to_owned(),
        settings: CommunitySettings {
            title: "Reading club".to_owned(),
            description: String::new(),
            public_handle: None,
            is_public: false,
            requires_approval: false,
        },
    };
    messages.create_community(sender.clone(), community).await.unwrap();
    let application = application(accounts.clone(), pool.clone());

    let (status, body) = set_suspension(
        &application,
        &operator,
        SuspensionRequest {
            user_id: target.user.id,
            is_suspended: true,
            reason: "reviewed an abuse report",
        },
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    assert!(matches!(login_alice(&accounts).await, Err(AccountError::InvalidCredentials)));
    assert_eq!(cookie_session_status(&application, &target).await, StatusCode::UNAUTHORIZED);

    let send = messages.send(sender.clone(), support::messaging::send_input(target.user.id));
    assert!(matches!(send.await, Err(AccountError::ConversationUnavailable)));
    let invitation = CommunityAction::Invite {
        invitation_id: Uuid::new_v4(),
        token: None,
        target_id: Some(target.user.id),
        expires_at: chrono::Utc::now() + chrono::Duration::days(1),
        max_uses: None,
    };
    let invite = messages.community_command(
        sender.clone(),
        CommunityCommand {
            operation_id: Uuid::new_v4(),
            conversation_id: community_id,
            action: invitation,
        },
    );
    assert!(matches!(invite.await, Err(AccountError::ConversationUnavailable)));
    assert!(messages.message(sender, shared.message.id).await.is_ok());

    let (status, body) = set_suspension(
        &application,
        &operator,
        SuspensionRequest {
            user_id: target.user.id,
            is_suspended: false,
            reason: "appeal accepted",
        },
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    assert_eq!(cookie_session_status(&application, &target).await, StatusCode::UNAUTHORIZED);
    assert!(matches!(email.confirm(verification).await, Err(AccountError::InvalidChallenge)));
    let reset = email.reset_password(PasswordReset {
        token: recovery,
        new_password: "a replacement password phrase".to_owned(),
    });
    assert!(matches!(reset.await, Err(AccountError::InvalidChallenge)));
    let fresh = login_alice(&accounts).await.unwrap();
    assert_eq!(cookie_session_status(&application, &fresh).await, StatusCode::OK);
}

struct SuspensionRequest {
    user_id: Uuid,
    is_suspended: bool,
    reason: &'static str,
}

async fn set_suspension(
    application: &Router,
    operator: &SessionGrant,
    input: SuspensionRequest,
) -> (StatusCode, Value) {
    let payload = json!({
        "operation_id": Uuid::new_v4(),
        "reason": input.reason,
        "action": {
            "kind": "set_suspension",
            "user_id": input.user_id,
            "is_suspended": input.is_suspended
        }
    });

    command(application, operator, payload).await
}

async fn cookie_session_status(application: &Router, grant: &SessionGrant) -> StatusCode {
    let request = Request::get("/api/v1/auth/session")
        .header("cookie", format!("tg_chat_session={}", grant.token))
        .body(Body::empty())
        .unwrap();

    application.clone().oneshot(request).await.unwrap().status()
}

async fn login_alice(accounts: &AccountService) -> Result<SessionGrant, AccountError> {
    accounts
        .login(Login {
            username: "alice".to_owned(),
            password: "a complete password phrase".to_owned(),
            device_name: "Browser".to_owned(),
        })
        .await
}
