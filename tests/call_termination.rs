#[allow(dead_code)]
mod support;

use std::time::Duration;

use sqlx::PgPool;
use tg_chat::{
    accounts::{
        AccountService, AccountSettings, Actor, DeleteAccount,
        operator::{SuspensionChange, UserStatus},
    },
    calls::{CallAction, CallCommand, CallEndReason, CallService},
    contacts::{Audience, PrivacySettings, RelationshipChange},
    messages::HistoryQuery,
    realtime::{self, WorkerServices},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const WORKER_TIMEOUT: Duration = Duration::from_secs(10);
const RETRY_INTERVAL: Duration = Duration::from_millis(20);
const WORKER_OBSERVATION: Duration = Duration::from_secs(2);
const IDLE_SESSION_DAYS: i64 = 30;

async fn wait_for_reason(pool: &PgPool, call_id: Uuid) -> String {
    tokio::time::timeout(WORKER_TIMEOUT, async {
        loop {
            let reason: Option<String> =
                sqlx::query_scalar("SELECT end_reason::text FROM calls WHERE id = $1")
                    .bind(call_id)
                    .fetch_one(pool)
                    .await
                    .unwrap();
            if let Some(reason) = reason {
                break reason;
            }
            tokio::time::sleep(RETRY_INTERVAL).await;
        }
    })
    .await
    .expect("Worker must terminate the call")
}

fn start_worker(pool: &PgPool, stop: CancellationToken) -> tokio::task::JoinHandle<()> {
    tokio::spawn(realtime::run(
        WorkerServices {
            pool: pool.clone(),
            client: None,
            idle_days: IDLE_SESSION_DAYS,
        },
        stop,
    ))
}

#[derive(Clone, Copy)]
struct PendingCall<'a> {
    caller: &'a Actor,
    recipient: &'a Actor,
    conversation_id: Uuid,
}

/// Store a live call without a realtime dependency so the Worker can exercise expiry.
async fn insert_ringing_call(pool: &PgPool, input: PendingCall<'_>) -> Uuid {
    let call_id = Uuid::new_v4();
    let query = sqlx::query(
        "INSERT INTO calls (
             id, conversation_id, caller_id, recipient_id, caller_session_id, mode,
             phase, revision, ringing_deadline, created_at
         ) VALUES ($1, $2, $3, $4, $5, 'voice', 'ringing', 1, now() + interval '1 hour', now())",
    );
    let query = query.bind(call_id).bind(input.conversation_id);
    let query = query.bind(input.caller.user_id).bind(input.recipient.user_id);
    query.bind(input.caller.session_id).execute(pool).await.unwrap();
    let slots = [input.caller.user_id, input.recipient.user_id];
    let query =
        sqlx::query("INSERT INTO call_slots (user_id, call_id) SELECT unnest($1::uuid[]), $2");
    query.bind(slots.as_slice()).bind(call_id).execute(pool).await.unwrap();

    call_id
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn termination_releases_slots_while_history_publication_is_blocked(pool: PgPool) {
    let (messages, caller, recipient) = support::messaging::fixture(pool.clone()).await;
    let send = support::messaging::send_input(recipient.user_id);
    let sent = messages.send(caller.clone(), send).await.unwrap();
    let conversation_id = sent.conversation.id;
    let call_id = insert_ringing_call(
        &pool,
        PendingCall {
            caller: &caller,
            recipient: &recipient,
            conversation_id,
        },
    )
    .await;
    sqlx::query("DELETE FROM sync_wakeups").execute(&pool).await.unwrap();
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let unrelated = support::account(&accounts, "carol").await;
    sqlx::query("UPDATE wakeup_queue_budget SET capacity = 1").execute(&pool).await.unwrap();
    let occupy = sqlx::query("INSERT INTO sync_wakeups (user_id, position) VALUES ($1, 1)");
    occupy.bind(unrelated.user_id).execute(&pool).await.unwrap();
    sqlx::query("UPDATE calls SET ringing_deadline = now() WHERE id = $1")
        .bind(call_id)
        .execute(&pool)
        .await
        .unwrap();

    let stop = CancellationToken::new();
    let task = start_worker(&pool, stop.clone());
    assert_eq!(wait_for_reason(&pool, call_id).await, "missed");
    let slots: i64 = sqlx::query_scalar("SELECT count(*) FROM call_slots WHERE call_id = $1")
        .bind(call_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(slots, 0);
    tokio::time::sleep(WORKER_OBSERVATION).await;
    assert!(call_message_ids(&pool, conversation_id).await.is_empty());
    stop.cancel();
    task.await.unwrap();

    sqlx::query("UPDATE wakeup_queue_budget SET capacity = 10000").execute(&pool).await.unwrap();
    let stop = CancellationToken::new();
    let task = start_worker(&pool, stop.clone());
    let message_id = wait_for_history(&pool, conversation_id).await;
    assert_ne!(message_id, call_id);
    let history = messages.history(
        recipient,
        HistoryQuery {
            conversation_id,
            ..HistoryQuery::default()
        },
    );
    let history = history.await.unwrap();
    let event = history.messages.iter().find(|message| message.id == message_id).unwrap();
    assert_eq!(event.service_kind.as_deref(), Some("call"));
    assert!(event.content.text.contains("missed"));
    let outsiders_history = messages.history(
        unrelated,
        HistoryQuery {
            conversation_id,
            ..HistoryQuery::default()
        },
    );
    assert!(outsiders_history.await.is_err());
    let identity: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM message_identities WHERE id = $1)")
            .bind(message_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(identity);
    let notification: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM push_intents WHERE message_id = $1)")
            .bind(message_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!notification);

    stop.cancel();
    task.await.unwrap();
    assert_eq!(call_message_ids(&pool, conversation_id).await, vec![message_id]);
}

async fn wait_for_history(pool: &PgPool, conversation_id: Uuid) -> Uuid {
    tokio::time::timeout(WORKER_TIMEOUT, async {
        loop {
            if let Some(message_id) = call_message_ids(pool, conversation_id).await.first() {
                break *message_id;
            }
            tokio::time::sleep(RETRY_INTERVAL).await;
        }
    })
    .await
    .expect("Worker must publish pending call history after restart")
}

async fn call_message_ids(pool: &PgPool, conversation_id: Uuid) -> Vec<Uuid> {
    sqlx::query_scalar(
        "SELECT id FROM messages WHERE conversation_id = $1 AND service_kind = 'call'",
    )
    .bind(conversation_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn policy_mutation_fences_calls_and_spares_unrelated_sessions(pool: PgPool) {
    let (messages, caller, recipient) = support::messaging::fixture(pool.clone()).await;
    let send = support::messaging::send_input(recipient.user_id);
    let sent = messages.send(caller.clone(), send).await.unwrap();
    let pending = PendingCall {
        caller: &caller,
        recipient: &recipient,
        conversation_id: sent.conversation.id,
    };
    let call_id = insert_ringing_call(&pool, pending).await;
    let unrelated_session_id = Uuid::new_v4();
    let session = sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, device_name, expires_at)
         VALUES ($1, $2, $3, 'Another browser', now() + interval '1 day')",
    );
    let session = session.bind(unrelated_session_id).bind(recipient.user_id);
    session.bind(vec![1_u8; 32]).execute(&pool).await.unwrap();
    let accept = sqlx::query(
        "UPDATE calls SET phase = 'connecting', accepting_session_id = $2,
             accepted_at = now(), setup_deadline = now() + interval '1 hour' WHERE id = $1",
    );
    accept.bind(call_id).bind(recipient.session_id).execute(&pool).await.unwrap();

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let revoke = tg_chat::accounts::RevokeSession {
        actor: recipient.clone(),
        session_id: unrelated_session_id,
    };
    accounts.revoke_session(revoke).await.unwrap();
    let privacy = PrivacySettings {
        direct_messages: Audience::Everyone,
        calls: Audience::Nobody,
        presence: Audience::Everyone,
    };
    accounts.update_privacy(&recipient, privacy).await.unwrap();

    let stop = CancellationToken::new();
    let task = start_worker(&pool, stop.clone());
    // Observe multiple passes before revoking the winning session.
    tokio::time::sleep(WORKER_OBSERVATION).await;
    let slots: i64 = sqlx::query_scalar("SELECT count(*) FROM call_slots WHERE call_id = $1")
        .bind(call_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(slots, 2);

    let revoke = tg_chat::accounts::RevokeSession {
        actor: recipient.clone(),
        session_id: recipient.session_id,
    };
    accounts.revoke_session(revoke).await.unwrap();
    assert_eq!(wait_for_reason(&pool, call_id).await, "access_revoked");
    stop.cancel();
    task.await.unwrap();
}

async fn observe_access_revoked(pool: &PgPool, call_id: Uuid) {
    let stop = CancellationToken::new();
    let task = start_worker(pool, stop.clone());
    assert_eq!(wait_for_reason(pool, call_id).await, "access_revoked");
    stop.cancel();
    task.await.unwrap();
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn removed_block_keeps_the_pending_call_fenced(pool: PgPool) {
    let (messages, caller, recipient) = support::messaging::fixture(pool.clone()).await;
    let send = support::messaging::send_input(recipient.user_id);
    let sent = messages.send(caller.clone(), send).await.unwrap();
    let pending = PendingCall {
        caller: &caller,
        recipient: &recipient,
        conversation_id: sent.conversation.id,
    };
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let calls = CallService::new(accounts.clone());
    let privacy = PrivacySettings {
        direct_messages: Audience::Everyone,
        calls: Audience::Everyone,
        presence: Audience::Everyone,
    };
    accounts.update_privacy(&recipient, privacy).await.unwrap();

    for (owner, target) in [(&caller, &recipient), (&recipient, &caller)] {
        let call_id = insert_ringing_call(&pool, pending).await;
        assert_eq!(calls.current(&recipient).await.unwrap().unwrap().id, call_id);

        let block = RelationshipChange {
            actor: owner.clone(),
            target_id: target.user_id,
        };
        accounts.add_block(block).await.unwrap();
        let unblock = RelationshipChange {
            actor: owner.clone(),
            target_id: target.user_id,
        };
        accounts.remove_block(unblock).await.unwrap();

        assert!(calls.current(&recipient).await.unwrap().is_none());
        observe_access_revoked(&pool, call_id).await;
    }
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn worker_terminates_calls_after_quarantine_account_and_session_invalidation(pool: PgPool) {
    let (messages, caller, recipient) = support::messaging::fixture(pool.clone()).await;
    let send = support::messaging::send_input(recipient.user_id);
    let sent = messages.send(caller.clone(), send).await.unwrap();
    let pending = PendingCall {
        caller: &caller,
        recipient: &recipient,
        conversation_id: sent.conversation.id,
    };
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());

    let call_id = insert_ringing_call(&pool, pending).await;
    let quarantine = sqlx::query("UPDATE conversations SET is_quarantined = true WHERE id = $1");
    quarantine.bind(pending.conversation_id).execute(&pool).await.unwrap();
    observe_access_revoked(&pool, call_id).await;
    let lift_quarantine =
        sqlx::query("UPDATE conversations SET is_quarantined = false WHERE id = $1");
    lift_quarantine.bind(pending.conversation_id).execute(&pool).await.unwrap();

    let call_id = insert_ringing_call(&pool, pending).await;
    let suspension = SuspensionChange {
        username: "bobby".to_owned(),
        status: UserStatus::Suspended,
        reason: "Exercise the suspension fence".to_owned(),
    };
    accounts.set_user_status(suspension).await.unwrap();
    observe_access_revoked(&pool, call_id).await;

    let restore = SuspensionChange {
        username: "bobby".to_owned(),
        status: UserStatus::Active,
        reason: "Restore the test account".to_owned(),
    };
    accounts.set_user_status(restore).await.unwrap();

    let call_id = insert_ringing_call(&pool, pending).await;
    let expire = sqlx::query("UPDATE sessions SET expires_at = now() WHERE id = $1");
    expire.bind(caller.session_id).execute(&pool).await.unwrap();
    observe_access_revoked(&pool, call_id).await;

    let call_id = insert_ringing_call(&pool, pending).await;
    let renew =
        sqlx::query("UPDATE sessions SET expires_at = now() + interval '1 day' WHERE id = $1");
    renew.bind(caller.session_id).execute(&pool).await.unwrap();
    let deletion = DeleteAccount {
        operation_id: Uuid::new_v4(),
        confirm_shared_messages: true,
    };
    accounts.delete_account(&caller, deletion).await.unwrap();
    observe_access_revoked(&pool, call_id).await;
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn retrying_a_terminal_command_publishes_one_chat_record(pool: PgPool) {
    let (messages, caller, recipient) = support::messaging::fixture(pool.clone()).await;
    let send = support::messaging::send_input(recipient.user_id);
    let sent = messages.send(caller.clone(), send).await.unwrap();
    let conversation_id = sent.conversation.id;
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let contact = RelationshipChange {
        actor: recipient.clone(),
        target_id: caller.user_id,
    };
    accounts.add_contact(contact).await.unwrap();
    let calls = CallService::new(accounts);
    let call_id = insert_ringing_call(
        &pool,
        PendingCall {
            caller: &caller,
            recipient: &recipient,
            conversation_id,
        },
    )
    .await;

    let operation_id = Uuid::new_v4();
    for _ in 0..2 {
        let command = CallCommand {
            call_id,
            operation_id,
            action: CallAction::Cancel,
        };
        let view = calls.command(&caller, command).await.unwrap();
        assert_eq!(view.end_reason, Some(CallEndReason::Cancelled));
    }

    let stop = CancellationToken::new();
    let task = start_worker(&pool, stop.clone());
    let message_id = wait_for_history(&pool, conversation_id).await;
    stop.cancel();
    task.await.unwrap();

    assert_eq!(call_message_ids(&pool, conversation_id).await, vec![message_id]);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn worker_expires_reconnect_without_a_media_provider(pool: PgPool) {
    let (messages, caller, recipient) = support::messaging::fixture(pool.clone()).await;
    let send = support::messaging::send_input(recipient.user_id);
    let sent = messages.send(caller.clone(), send).await.unwrap();
    let call_id = insert_ringing_call(
        &pool,
        PendingCall {
            caller: &caller,
            recipient: &recipient,
            conversation_id: sent.conversation.id,
        },
    )
    .await;

    let depart = sqlx::query(
        "UPDATE calls SET phase = 'active', accepting_session_id = $2, accepted_at = now(),
             active_at = now(), setup_deadline = now(), reconnect_deadline = now()
         WHERE id = $1",
    );
    depart.bind(call_id).bind(recipient.session_id).execute(&pool).await.unwrap();

    let stop = CancellationToken::new();
    let task = start_worker(&pool, stop.clone());
    assert_eq!(wait_for_reason(&pool, call_id).await, "transport_failed");
    stop.cancel();
    task.await.unwrap();
}
