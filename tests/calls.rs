#[allow(dead_code)]
mod support;

use std::num::NonZeroU32;

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use serde_json::json;
use sqlx::PgPool;
use tg_chat::{
    config::ServiceKind,
    features::{
        accounts::{
            AccountError, AccountService, AccountSettings, Actor, Login, Registration,
            http::AccountHttpState, transport::HttpSettings,
        },
        calls::{
            CallAction, CallCommand, CallEndReason, CallMode, CallPhase, CallService, StartCall,
        },
        messages::Destination,
    },
    http::{ApplicationState, router_with_api},
};
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn disabled_runtime_returns_no_current_call(pool: PgPool) {
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
    let settings = HttpSettings::from_values(&Default::default()).unwrap();
    let cookie = settings.session_cookie(&grant.token);
    let cookie = cookie.split(';').next().unwrap();
    let account_state =
        AccountHttpState::new(accounts, settings, support::mail_queue(pool.clone()));
    let application = router_with_api(
        ApplicationState {
            pool,
            service: ServiceKind::Api,
        },
        tg_chat::features::accounts::http::router(account_state),
    );
    let request = Request::builder().uri("/api/v1/calls/current").header(header::COOKIE, cookie);
    let request = request.body(Body::empty()).unwrap();

    let response = application.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let body = axum::body::to_bytes(response.into_body(), 1024).await.unwrap();
    assert_eq!(serde_json::from_slice::<serde_json::Value>(&body).unwrap(), json!({"call": null}));
}

struct DirectCall {
    service: CallService,
    accounts: AccountService,
    caller: Actor,
    recipient: Actor,
    conversation_id: Uuid,
}

async fn direct_call(pool: &PgPool) -> DirectCall {
    let (messages, caller, recipient) = support::messaging::fixture(pool.clone()).await;
    let input = support::messaging::send_input(recipient.user_id);
    let sent = messages.send(caller.clone(), input).await.unwrap();
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());

    DirectCall {
        service: CallService::new(accounts.clone()),
        accounts,
        caller,
        recipient,
        conversation_id: sent.conversation.id,
    }
}

async fn save_contact(pool: &PgPool, owner: &Actor, target: &Actor) {
    let insert = sqlx::query("INSERT INTO contacts (owner_id, target_id) VALUES ($1, $2)");
    let insert = insert.bind(owner.user_id).bind(target.user_id);
    insert.execute(pool).await.unwrap();
}

fn start(conversation_id: Uuid) -> StartCall {
    StartCall {
        operation_id: Uuid::new_v4(),
        conversation_id,
        mode: CallMode::Voice,
    }
}

fn command(call_id: Uuid, action: CallAction) -> CallCommand {
    CallCommand {
        call_id,
        operation_id: Uuid::new_v4(),
        action,
    }
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn cross_calls_reserve_one_slot_per_account(pool: PgPool) {
    let fixture = direct_call(&pool).await;
    save_contact(&pool, &fixture.caller, &fixture.recipient).await;
    save_contact(&pool, &fixture.recipient, &fixture.caller).await;

    let (outgoing, crossed) = tokio::join!(
        fixture.service.start(&fixture.caller, start(fixture.conversation_id)),
        fixture.service.start(&fixture.recipient, start(fixture.conversation_id)),
    );
    match (outgoing, crossed) {
        (Ok(call), Err(AccountError::CallBusy)) | (Err(AccountError::CallBusy), Ok(call)) => {
            assert_eq!(call.phase, CallPhase::Ringing);
        }
        results => panic!("expected one admitted call and one busy response, got {results:?}"),
    }
    let counts: (i64, i64) =
        sqlx::query_as("SELECT (SELECT count(*) FROM calls), (SELECT count(*) FROM call_slots)")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(counts, (1, 2));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn first_accept_wins_and_late_accept_observes_current_state(pool: PgPool) {
    let fixture = direct_call(&pool).await;
    save_contact(&pool, &fixture.recipient, &fixture.caller).await;
    let grant = fixture
        .accounts
        .login(Login {
            username: "bobby".to_owned(),
            password: "a complete password phrase".to_owned(),
            device_name: "Second browser".to_owned(),
        })
        .await
        .unwrap();
    let second_recipient = fixture.accounts.authenticate(&grant.token).await.unwrap();
    let call =
        fixture.service.start(&fixture.caller, start(fixture.conversation_id)).await.unwrap();

    let first_command = command(call.id, CallAction::Accept);
    let second_command = command(call.id, CallAction::Accept);
    let (first, second) = tokio::join!(
        fixture.service.command(&fixture.recipient, first_command),
        fixture.service.command(&second_recipient, second_command),
    );
    let first = first.unwrap();
    let second = second.unwrap();
    assert_eq!(first.phase, CallPhase::Connecting);
    assert_eq!(second.phase, CallPhase::Connecting);
    assert_eq!(first.revision, second.revision);
    assert_eq!(first.revision, "2");

    let winner: Uuid = sqlx::query_scalar("SELECT accepting_session_id FROM calls WHERE id = $1")
        .bind(call.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let (designated, unselected, unselected_actor) = if winner == fixture.recipient.session_id {
        (first, second, second_recipient)
    } else {
        assert_eq!(winner, second_recipient.session_id);
        (second, first, fixture.recipient)
    };
    assert!(designated.allowed_actions.contains(&CallAction::Hangup));
    assert!(unselected.allowed_actions.is_empty());
    assert!(fixture.service.current(&unselected_actor).await.unwrap().is_none());

    let stale_hangup = command(call.id, CallAction::Hangup);
    let unchanged = fixture.service.command(&unselected_actor, stale_hangup).await.unwrap();
    assert_eq!(unchanged.revision, "2");
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn expired_ringing_rejects_accept_after_lock_wait(pool: PgPool) {
    let fixture = direct_call(&pool).await;
    save_contact(&pool, &fixture.recipient, &fixture.caller).await;
    let call =
        fixture.service.start(&fixture.caller, start(fixture.conversation_id)).await.unwrap();
    let deadline = sqlx::query(
        "UPDATE calls SET ringing_deadline = clock_timestamp() + interval '3 seconds'
         WHERE id = $1",
    );
    deadline.bind(call.id).execute(&pool).await.unwrap();

    let mut blocker = pool.begin().await.unwrap();
    let lock = sqlx::query("SELECT id FROM calls WHERE id = $1 FOR UPDATE");
    lock.bind(call.id).execute(&mut *blocker).await.unwrap();
    let calls = fixture.service.clone();
    let recipient = fixture.recipient.clone();
    let accepting = tokio::spawn(async move {
        calls.command(&recipient, command(call.id, CallAction::Accept)).await
    });

    assert_accept_waits_before_deadline(&pool).await;
    let sleep_until_deadline = sqlx::query(
        "SELECT pg_sleep(GREATEST(EXTRACT(EPOCH FROM ringing_deadline - clock_timestamp()), 0))
         FROM calls WHERE id = $1",
    );
    sleep_until_deadline.bind(call.id).execute(&mut *blocker).await.unwrap();
    blocker.commit().await.unwrap();

    let expired = accepting.await.unwrap().unwrap();
    assert_eq!(expired.phase, CallPhase::Ended);
    assert_eq!(expired.end_reason, Some(CallEndReason::Missed));
    assert!(expired.allowed_actions.is_empty());
    let winner: Option<Uuid> =
        sqlx::query_scalar("SELECT accepting_session_id FROM calls WHERE id = $1")
            .bind(call.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(winner.is_none());
    assert!(fixture.service.current(&fixture.recipient).await.unwrap().is_none());
}

async fn assert_accept_waits_before_deadline(pool: &PgPool) {
    use std::time::Duration;

    let wait = async {
        loop {
            let waiting: bool = sqlx::query_scalar(
                "SELECT EXISTS (
                    SELECT 1 FROM pg_stat_activity
                    WHERE datname = current_database() AND wait_event_type = 'Lock'
                      AND query = $1
                 )",
            )
            .bind("SELECT * FROM calls WHERE id = $1 FOR UPDATE")
            .fetch_one(pool)
            .await
            .unwrap();
            if waiting {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    };

    tokio::time::timeout(Duration::from_secs(2), wait)
        .await
        .expect("accept must wait on the row lock before the ringing deadline");
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn starts_require_the_recipients_directional_contact(pool: PgPool) {
    let fixture = direct_call(&pool).await;
    save_contact(&pool, &fixture.caller, &fixture.recipient).await;
    let input = start(fixture.conversation_id);

    let denied = fixture.service.start(&fixture.caller, input).await;
    assert!(matches!(denied, Err(AccountError::CallNotAllowed)));

    save_contact(&pool, &fixture.recipient, &fixture.caller).await;
    let call = fixture.service.start(&fixture.caller, input).await.unwrap();
    assert_eq!(call.phase, CallPhase::Ringing);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn blocks_and_quarantine_prevent_ringing(pool: PgPool) {
    let fixture = direct_call(&pool).await;
    save_contact(&pool, &fixture.recipient, &fixture.caller).await;
    let input = start(fixture.conversation_id);

    for (owner, target) in
        [(&fixture.caller, &fixture.recipient), (&fixture.recipient, &fixture.caller)]
    {
        let insert = sqlx::query("INSERT INTO blocks (owner_id, target_id) VALUES ($1, $2)");
        let insert = insert.bind(owner.user_id).bind(target.user_id);
        insert.execute(&pool).await.unwrap();
        let result = fixture.service.start(&fixture.caller, input).await;
        assert!(matches!(result, Err(AccountError::CallNotAllowed)));
        sqlx::query("DELETE FROM blocks").execute(&pool).await.unwrap();
    }

    let quarantine = sqlx::query("UPDATE conversations SET is_quarantined = true WHERE id = $1");
    quarantine.bind(fixture.conversation_id).execute(&pool).await.unwrap();

    let result = fixture.service.start(&fixture.caller, input).await;
    assert!(matches!(result, Err(AccountError::CallNotAllowed)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn expired_sessions_cannot_start_calls(pool: PgPool) {
    let fixture = direct_call(&pool).await;
    save_contact(&pool, &fixture.recipient, &fixture.caller).await;
    let expire = sqlx::query("UPDATE sessions SET expires_at = clock_timestamp() WHERE id = $1");
    expire.bind(fixture.caller.session_id).execute(&pool).await.unwrap();

    let result = fixture.service.start(&fixture.caller, start(fixture.conversation_id)).await;
    assert!(matches!(result, Err(AccountError::Unauthenticated)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn saved_messages_are_not_a_call_target(pool: PgPool) {
    let (messages, caller, _) = support::messaging::fixture(pool.clone()).await;
    let mut input = support::messaging::send_input(caller.user_id);
    input.destination = Destination::Saved;
    let saved = messages.send(caller.clone(), input).await.unwrap();
    let accounts = AccountService::new(pool, AccountSettings::default());
    let calls = CallService::new(accounts);

    let result = calls.start(&caller, start(saved.conversation.id)).await;
    assert!(matches!(result, Err(AccountError::CallNotAllowed)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn independent_pairs_share_the_deployment_capacity(pool: PgPool) {
    let fixture = direct_call(&pool).await;
    let maximum = NonZeroU32::new(1).unwrap();
    let calls = fixture.service.with_capacity(maximum);
    save_contact(&pool, &fixture.recipient, &fixture.caller).await;
    let other_caller = support::account(&fixture.accounts, "chris").await;
    let other_recipient = support::account(&fixture.accounts, "donna").await;
    save_contact(&pool, &other_recipient, &other_caller).await;
    let messages = tg_chat::features::messages::MessageService::new(fixture.accounts);
    let input = support::messaging::send_input(other_recipient.user_id);
    let other_chat = messages.send(other_caller.clone(), input).await.unwrap();

    calls.start(&fixture.caller, start(fixture.conversation_id)).await.unwrap();
    let denied = calls.start(&other_caller, start(other_chat.conversation.id)).await;
    assert!(matches!(denied, Err(AccountError::CallBusy)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn replay_preserves_the_original_call_and_rejects_conflicting_payloads(pool: PgPool) {
    let fixture = direct_call(&pool).await;
    save_contact(&pool, &fixture.recipient, &fixture.caller).await;
    let input = start(fixture.conversation_id);
    let original = fixture.service.start(&fixture.caller, input).await.unwrap();
    let replay = fixture.service.start(&fixture.caller, input).await.unwrap();
    assert_eq!(original.id, replay.id);
    assert_eq!(original.revision, replay.revision);

    let conflicting = StartCall {
        mode: CallMode::Video,
        ..input
    };
    let result = fixture.service.start(&fixture.caller, conflicting).await;
    assert!(matches!(result, Err(AccountError::OperationConflict)));

    let cancel = command(original.id, CallAction::Cancel);
    let ended = fixture.service.command(&fixture.caller, cancel).await.unwrap();
    let replay = fixture.service.start(&fixture.caller, input).await.unwrap();
    assert_eq!(replay.id, original.id);
    assert_eq!(replay.revision, ended.revision);
    assert_eq!(replay.phase, CallPhase::Ended);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn a_cancelled_call_cannot_be_accepted(pool: PgPool) {
    let fixture = direct_call(&pool).await;
    save_contact(&pool, &fixture.recipient, &fixture.caller).await;
    let call =
        fixture.service.start(&fixture.caller, start(fixture.conversation_id)).await.unwrap();

    let cancel = command(call.id, CallAction::Cancel);
    let cancelled = fixture.service.command(&fixture.caller, cancel).await.unwrap();
    let late_accept = command(call.id, CallAction::Accept);
    let stale = fixture.service.command(&fixture.recipient, late_accept).await.unwrap();

    assert_eq!(stale.phase, CallPhase::Ended);
    assert_eq!(stale.end_reason, Some(CallEndReason::Cancelled));
    assert_eq!(stale.revision, cancelled.revision);
    assert!(stale.allowed_actions.is_empty());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn only_five_new_starts_per_minute_are_admitted(pool: PgPool) {
    let fixture = direct_call(&pool).await;
    save_contact(&pool, &fixture.recipient, &fixture.caller).await;

    for _ in 0..5 {
        let input = start(fixture.conversation_id);
        let call = fixture.service.start(&fixture.caller, input).await.unwrap();
        let cancel = command(call.id, CallAction::Cancel);
        fixture.service.command(&fixture.caller, cancel).await.unwrap();

        let replay = fixture.service.start(&fixture.caller, input).await.unwrap();
        assert_eq!(replay.id, call.id);
        assert_eq!(replay.phase, CallPhase::Ended);
    }

    let denied = fixture.service.start(&fixture.caller, start(fixture.conversation_id)).await;
    assert!(matches!(denied, Err(AccountError::RateLimited)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn current_stops_showing_an_expired_ring_before_the_worker_runs(pool: PgPool) {
    let fixture = direct_call(&pool).await;
    save_contact(&pool, &fixture.recipient, &fixture.caller).await;
    let input = start(fixture.conversation_id);
    let call = fixture.service.start(&fixture.caller, input).await.unwrap();
    let visible = fixture.service.current(&fixture.recipient).await.unwrap().unwrap();
    assert_eq!(visible.id, call.id);

    let expire = sqlx::query(
        "UPDATE calls SET ringing_deadline = clock_timestamp() - interval '1 second'
         WHERE id = $1",
    );
    expire.bind(call.id).execute(&pool).await.unwrap();

    assert!(fixture.service.current(&fixture.recipient).await.unwrap().is_none());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn only_the_designated_session_reads_the_private_call_outcome(pool: PgPool) {
    let fixture = direct_call(&pool).await;
    save_contact(&pool, &fixture.recipient, &fixture.caller).await;
    let login = || Login {
        username: "bobby".to_owned(),
        password: "a complete password phrase".to_owned(),
        device_name: "Outcome browser".to_owned(),
    };
    let designated = fixture.accounts.login(login()).await.unwrap();
    let other = fixture.accounts.login(login()).await.unwrap();
    let recipient = fixture.accounts.authenticate(&designated.token).await.unwrap();
    let call =
        fixture.service.start(&fixture.caller, start(fixture.conversation_id)).await.unwrap();
    let accept = command(call.id, CallAction::Accept);
    fixture.service.command(&recipient, accept).await.unwrap();
    let denied = command(call.id, CallAction::MediaPermissionDenied);
    fixture.service.command(&fixture.caller, denied).await.unwrap();

    let settings = HttpSettings::from_values(&Default::default()).unwrap();
    let winning_cookie = settings.session_cookie(&designated.token);
    let losing_cookie = settings.session_cookie(&other.token);
    let state = AccountHttpState::new(fixture.accounts, settings, support::mail_queue(pool));
    let application = tg_chat::features::accounts::http::router(state.with_calls(fixture.service));

    let path = format!("/api/v1/calls/{}/outcome", call.id);
    let read = |cookie: &str| {
        let request = Request::get(&path).header(header::COOKIE, cookie.split(';').next().unwrap());
        application.clone().oneshot(request.body(Body::empty()).unwrap())
    };
    let visible = read(&winning_cookie).await.unwrap();
    assert_eq!(visible.status(), StatusCode::OK);
    let body = axum::body::to_bytes(visible.into_body(), 1024).await.unwrap();
    let outcome = serde_json::from_slice::<serde_json::Value>(&body).unwrap();
    assert_eq!(outcome, json!({"end_reason": "permission_denied"}));

    let forbidden = read(&losing_cookie).await.unwrap();
    assert_eq!(forbidden.status(), StatusCode::NOT_FOUND);
}
