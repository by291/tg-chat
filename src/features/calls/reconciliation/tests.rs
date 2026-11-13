use base64::{Engine, engine::general_purpose::STANDARD};
use livekit_api::access_token::AccessToken;
use serde_json::json;
use sha2::{Digest, Sha256};

use super::*;
use crate::features::{
    accounts::{AccountService, AccountSettings, Actor, Registration},
    calls::{
        CallAction, CallCommand, CallMode, CallService, StartCall, livekit::VerifiedRoomEvent,
        webhook::record_room_event,
    },
    messages::MessageService,
};

const ROOM: &str = "call-fixture";
const SID: &str = "RM_fixture";

async fn account(accounts: &AccountService, username: &str) -> Actor {
    let request = Registration {
        username: username.to_owned(),
        display_name: username.to_owned(),
        password: "a fixture password with several words".to_owned(),
        device_name: "Fixture browser".to_owned(),
    };
    let grant = accounts.register(request).await.unwrap();
    accounts.authenticate(&grant.token).await.unwrap()
}

async fn accepted_room(pool: &PgPool) -> Uuid {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let caller = account(&accounts, "call_caller").await;
    let recipient = account(&accounts, "call_recipient").await;
    let contacts = crate::features::contacts::RelationshipChange {
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

    let room = sqlx::query(
        "INSERT INTO call_rooms
            (call_id, room_name, caller_identity, recipient_identity, provider_sid)
         VALUES ($1, $2, gen_random_uuid(), gen_random_uuid(), $3)",
    );
    room.bind(call.id).bind(ROOM).bind(SID).execute(pool).await.unwrap();

    call.id
}

async fn observation(pool: &PgPool, call_id: Uuid) -> ProbeClaim {
    let make_due =
        sqlx::query("UPDATE call_rooms SET probe_after = clock_timestamp() WHERE call_id = $1");
    make_due.bind(call_id).execute(pool).await.unwrap();

    claim_probes(pool).await.unwrap().pop().unwrap()
}

async fn observe(pool: &PgPool, claim: ProbeClaim, media: MediaState) -> Option<CallRow> {
    let mut transaction = pool.begin().await.unwrap();
    let observation = RoomObservation {
        claim,
        media,
        idle_days: AccountSettings::default().idle_days,
    };
    let result = apply_room_observation(&mut transaction, observation).await.unwrap();
    transaction.commit().await.unwrap();

    result
}

#[sqlx::test]
#[ignore = "requires isolated PostgreSQL"]
async fn missing_webhook_recovers_from_room_snapshot(pool: PgPool) {
    let call_id = accepted_room(&pool).await;
    let claim = observation(&pool, call_id).await;
    let snapshot = RoomSnapshot {
        sid: claim.provider_sid.clone(),
        connected_participants: vec![claim.caller_identity, Uuid::new_v4()],
    };
    let media = media_state(&claim, Ok(Some(snapshot)));
    assert!(observe(&pool, claim, media).await.is_none());

    let claim = observation(&pool, call_id).await;
    let snapshot = RoomSnapshot {
        sid: claim.provider_sid.clone(),
        connected_participants: vec![claim.caller_identity, claim.recipient_identity],
    };
    let media = media_state(&claim, Ok(Some(snapshot)));
    let active = observe(&pool, claim, media).await.unwrap();
    assert_eq!(active.phase, CallPhase::Active);
}

#[sqlx::test]
#[ignore = "requires isolated PostgreSQL"]
async fn stale_leave_and_stale_probe_cannot_override_reconnect(pool: PgPool) {
    let call_id = accepted_room(&pool).await;
    let connected = observation(&pool, call_id).await;
    observe(&pool, connected, MediaState::Connected).await.unwrap();

    let stale = observation(&pool, call_id).await;
    let expire = sqlx::query(
        "UPDATE call_rooms SET probe_lease_until = clock_timestamp() WHERE call_id = $1",
    );
    expire.bind(call_id).execute(&pool).await.unwrap();
    let departed = observation(&pool, call_id).await;
    let media = media_state(&departed, Err(AccountError::Unavailable));
    let reconnecting = observe(&pool, departed, media).await.unwrap();
    assert!(reconnecting.reconnect_deadline.is_some());

    let repeated_failure = observation(&pool, call_id).await;
    let media = media_state(&repeated_failure, Err(AccountError::Unavailable));
    assert!(observe(&pool, repeated_failure, media).await.is_none());
    let recovered = observation(&pool, call_id).await;
    let active = observe(&pool, recovered, MediaState::Connected).await.unwrap();
    assert!(active.reconnect_deadline.is_none());

    let delayed_leave = VerifiedRoomEvent {
        id: "EV_FixtureEvent".to_owned(),
        room: ROOM.to_owned(),
        sid: SID.to_owned(),
    };
    record_room_event(&pool, &delayed_leave).await.unwrap();
    record_room_event(&pool, &delayed_leave).await.unwrap();
    assert!(observe(&pool, stale, MediaState::Disconnected).await.is_none());

    let after: CallRow = sqlx::query_as("SELECT * FROM calls WHERE id = $1")
        .bind(call_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(after.revision, active.revision);
    assert!(after.reconnect_deadline.is_none());

    let receipts: i64 = sqlx::query_scalar("SELECT count(*) FROM call_webhook_receipts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(receipts, 1);
}

#[sqlx::test]
#[ignore = "requires isolated PostgreSQL"]
async fn reconnect_expiry_wins_over_late_recovery_and_event_schedules_cleanup(pool: PgPool) {
    let call_id = accepted_room(&pool).await;
    let connected = observation(&pool, call_id).await;
    observe(&pool, connected, MediaState::Connected).await.unwrap();

    let wrong_sid = observation(&pool, call_id).await;
    let snapshot = RoomSnapshot {
        sid: "RM_replaced".to_owned(),
        connected_participants: vec![wrong_sid.caller_identity, wrong_sid.recipient_identity],
    };
    let media = media_state(&wrong_sid, Ok(Some(snapshot)));
    let reconnecting = observe(&pool, wrong_sid, media).await.unwrap();
    assert_eq!(reconnecting.phase, CallPhase::Active);
    assert!(reconnecting.reconnect_deadline.is_some());

    let late_recovery = observation(&pool, call_id).await;
    let expire =
        sqlx::query("UPDATE calls SET reconnect_deadline = clock_timestamp() WHERE id = $1");
    expire.bind(call_id).execute(&pool).await.unwrap();
    let ended = observe(&pool, late_recovery, MediaState::Connected).await.unwrap();
    assert_eq!(ended.phase, CallPhase::Ended);
    assert_eq!(ended.end_reason, Some(crate::features::calls::CallEndReason::TransportFailed));

    let simulate_cleanup = sqlx::query("DELETE FROM call_room_cleanup WHERE call_id = $1");
    simulate_cleanup.bind(call_id).execute(&pool).await.unwrap();

    let late_event = VerifiedRoomEvent {
        id: "EV_FixtureEvent".to_owned(),
        room: ROOM.to_owned(),
        sid: SID.to_owned(),
    };
    record_room_event(&pool, &late_event).await.unwrap();
    assert!(claim_probes(&pool).await.unwrap().is_empty());
    let cleanup_revision =
        sqlx::query_scalar::<_, i64>("SELECT revision FROM call_room_cleanup WHERE call_id = $1");
    assert_eq!(cleanup_revision.bind(call_id).fetch_one(&pool).await.unwrap(), ended.revision);

    let history =
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM call_history_work WHERE call_id = $1");
    assert_eq!(history.bind(call_id).fetch_one(&pool).await.unwrap(), 1);
}

#[sqlx::test]
#[ignore = "requires isolated PostgreSQL"]
async fn signed_webhook_body_is_verified_and_opaque_id_is_deduplicated(pool: PgPool) {
    accepted_room(&pool).await;
    let key = "fixture-key";
    let secret = "fixture-only-secret".repeat(2);
    let values = std::collections::HashMap::from([
        ("TG_CHAT_CALLS_ENABLED".to_owned(), "true".to_owned()),
        ("TG_CHAT_PUBLIC_ORIGIN".to_owned(), "https://chat.example.test".to_owned()),
        ("TG_CHAT_LIVEKIT_INTERNAL_URL".to_owned(), "http://livekit:7880".to_owned()),
        ("TG_CHAT_LIVEKIT_PUBLIC_URL".to_owned(), "wss://chat.example.test".to_owned()),
        ("TG_CHAT_LIVEKIT_API_KEY".to_owned(), key.to_owned()),
        ("TG_CHAT_LIVEKIT_API_SECRET".to_owned(), secret.clone()),
    ]);
    let provider = LiveKit::from_values(&values).unwrap().unwrap();
    let event = json!({
        "event": "participant_left",
        "id": "EV_A2jKL2FD9YSX",
        "room": {"name": ROOM, "sid": SID},
    });
    let body = event.to_string();
    let input = crate::features::calls::webhook::ReceiveWebhook {
        pool: &pool,
        provider: &provider,
        body: &body,
        token: "invalid-signature",
    };
    let result = crate::features::calls::webhook::receive(input).await;
    assert!(matches!(result, Err(AccountError::Forbidden)));

    let receipts: i64 = sqlx::query_scalar("SELECT count(*) FROM call_webhook_receipts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(receipts, 0);

    let digest = Sha256::digest(body.as_bytes());
    let checksum = STANDARD.encode(digest);
    let token = AccessToken::with_api_key(key, &secret).with_sha256(&checksum);
    let token = token.to_jwt().unwrap();
    let tampered_body = format!("{body} ");
    let input = crate::features::calls::webhook::ReceiveWebhook {
        pool: &pool,
        provider: &provider,
        body: &tampered_body,
        token: &token,
    };
    let result = crate::features::calls::webhook::receive(input).await;
    assert!(matches!(result, Err(AccountError::Forbidden)));

    for _ in 0..2 {
        let input = crate::features::calls::webhook::ReceiveWebhook {
            pool: &pool,
            provider: &provider,
            body: &body,
            token: &token,
        };
        crate::features::calls::webhook::receive(input).await.unwrap();
    }

    let event_ids: Vec<String> = sqlx::query_scalar("SELECT event_id FROM call_webhook_receipts")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(event_ids, ["EV_A2jKL2FD9YSX"]);
}
