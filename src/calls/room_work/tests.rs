use std::collections::HashMap;

use serde_json::json;

use super::*;
use crate::{
    accounts::{AccountService, AccountSettings, Actor, Registration},
    calls::{CallAction, CallCommand, CallMode, CallService, StartCall, rooms::CallRooms},
    messages::MessageService,
};

async fn account(accounts: &AccountService, username: &str) -> Actor {
    let grant = accounts
        .register(Registration {
            username: username.to_owned(),
            display_name: username.to_owned(),
            password: "a fixture password with several words".to_owned(),
            device_name: "Fixture browser".to_owned(),
        })
        .await
        .unwrap();
    accounts.authenticate(&grant.token).await.unwrap()
}

async fn accepted_call(pool: &PgPool) -> (CallService, Actor, Actor, Uuid) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let caller = account(&accounts, "call_caller").await;
    let recipient = account(&accounts, "call_recipient").await;
    let contacts = crate::contacts::RelationshipChange {
        actor: recipient.clone(),
        target_id: caller.user_id,
    };
    accounts.add_contact(contacts).await.unwrap();
    let messages = MessageService::new(accounts.clone());
    let input = serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "message_id": Uuid::new_v4(),
        "destination": {"kind": "recipient", "user_id": recipient.user_id},
        "content": {"schema_version": 1, "text": "Call setup", "custom_emoji": []},
    }))
    .unwrap();
    let sent = messages.send(caller.clone(), input).await.unwrap();

    let calls = CallService::new(accounts);
    let request = StartCall {
        operation_id: Uuid::new_v4(),
        conversation_id: sent.conversation.id,
        mode: CallMode::Voice,
    };
    let call = calls.start(&caller, request).await.unwrap();
    let accept = CallCommand {
        call_id: call.id,
        operation_id: Uuid::new_v4(),
        action: CallAction::Accept,
    };
    calls.command(&recipient, accept).await.unwrap();

    (calls, caller, recipient, call.id)
}

fn fixture_provider() -> LiveKit {
    let values = HashMap::from([
        ("TG_CHAT_CALLS_ENABLED".to_owned(), "true".to_owned()),
        ("TG_CHAT_LIVEKIT_INTERNAL_URL".to_owned(), "http://livekit:7880".to_owned()),
        ("TG_CHAT_LIVEKIT_API_KEY".to_owned(), "fixture-key".to_owned()),
        ("TG_CHAT_LIVEKIT_API_SECRET".to_owned(), "fixture-only-secret".repeat(2)),
    ]);

    LiveKit::from_values(&values).unwrap().unwrap()
}

#[sqlx::test]
#[ignore = "requires isolated PostgreSQL"]
async fn late_room_creation_is_cleaned_after_hangup(pool: PgPool) {
    let (calls, caller, _, call_id) = accepted_call(&pool).await;
    let provider = fixture_provider();
    let access = CallRooms::new(pool.clone(), calls.clone(), provider.clone());
    let work = RoomWork::new(pool, provider, None);
    work.reserve_room().await.unwrap();
    let claim = work.claim_create().await.unwrap().unwrap();

    let hangup = CallCommand {
        call_id,
        operation_id: Uuid::new_v4(),
        action: CallAction::Hangup,
    };
    calls.command(&caller, hangup).await.unwrap();
    work.publish_create(claim, "RM_fixture".to_owned()).await.unwrap();

    assert!(matches!(access.credentials(&caller, call_id).await, Err(AccountError::Forbidden)));
    let cleanup = work.claim_cleanup().await.unwrap().unwrap();
    assert_eq!(cleanup.call_id, call_id);
    assert!(cleanup.room_name.is_some());
}

#[sqlx::test]
#[ignore = "requires isolated PostgreSQL"]
async fn gateway_admission_uses_current_designated_call_state(pool: PgPool) {
    let (calls, caller, recipient, call_id) = accepted_call(&pool).await;
    let provider = fixture_provider();
    let work = RoomWork::new(pool.clone(), provider.clone(), None);
    let access = CallRooms::new(pool, calls.clone(), provider);
    work.reserve_room().await.unwrap();
    let claim = work.claim_create().await.unwrap().unwrap();
    work.publish_create(claim, "RM_fixture".to_owned()).await.unwrap();

    let unrelated_session = Actor {
        user_id: recipient.user_id,
        session_id: caller.session_id,
    };
    assert!(access.credentials(&unrelated_session, call_id).await.is_err());
    let token = access.credentials(&recipient, call_id).await.unwrap();
    assert!(access.authorize_signaling(token.token()).await.is_ok());

    let hangup = CallCommand {
        call_id,
        operation_id: Uuid::new_v4(),
        action: CallAction::Hangup,
    };
    calls.command(&caller, hangup).await.unwrap();

    assert!(matches!(
        access.authorize_signaling(token.token()).await,
        Err(AccountError::Forbidden)
    ));
}

#[sqlx::test]
#[ignore = "requires isolated PostgreSQL"]
async fn successful_create_retry_preserves_the_earlier_cleanup_fence(pool: PgPool) {
    let (calls, caller, _, call_id) = accepted_call(&pool).await;
    let work = RoomWork::new(pool.clone(), fixture_provider(), None);
    work.reserve_room().await.unwrap();
    let first = work.claim_create().await.unwrap().unwrap();
    work.retry_create(first).await.unwrap();
    let due =
        sqlx::query("UPDATE call_rooms SET create_after = clock_timestamp() WHERE call_id = $1");
    due.bind(call_id).execute(&pool).await.unwrap();
    let second = work.claim_create().await.unwrap().unwrap();
    work.publish_create(second, "RM_retry".to_owned()).await.unwrap();

    let hangup = CallCommand {
        call_id,
        operation_id: Uuid::new_v4(),
        action: CallAction::Hangup,
    };
    calls.command(&caller, hangup).await.unwrap();

    assert!(work.claim_cleanup().await.unwrap().is_none());
    let settled =
        sqlx::query("UPDATE call_rooms SET cleanup_safe_at = clock_timestamp() WHERE call_id = $1");
    settled.bind(call_id).execute(&pool).await.unwrap();
    assert_eq!(work.claim_cleanup().await.unwrap().unwrap().call_id, call_id);
}
