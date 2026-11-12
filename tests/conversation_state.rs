#[allow(dead_code)]
mod support;

use serde_json::json;
use sqlx::PgPool;
use support::messaging::{command, fixture, send_input};
use tg_chat::{accounts::AccountError, messages::HistoryQuery};

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn drafts_conflict_and_send_clears_only_its_captured_version(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool).await;
    let sent = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let draft = command(
        sent.conversation.id,
        json!({
            "kind": "draft",
            "expected_version": "0",
            "content": {"schema_version": 1, "text": "First draft", "custom_emoji": []}
        }),
    );
    let first = service.command(alice.clone(), draft.clone()).await.unwrap();
    assert_eq!(first.conversation.unwrap().draft.version, "1");
    let mut competing = draft;
    competing.operation_id = uuid::Uuid::new_v4();
    assert!(matches!(
        service.command(alice.clone(), competing).await,
        Err(AccountError::MessageConflict)
    ));

    let newer = command(
        sent.conversation.id,
        json!({
            "kind": "draft",
            "expected_version": "1",
            "content": {"schema_version": 1, "text": "New typing", "custom_emoji": []}
        }),
    );
    service.command(alice.clone(), newer).await.unwrap();
    let mut outgoing = serde_json::to_value(send_input(bobby.user_id)).unwrap();
    outgoing["draft_version"] = json!("1");
    let accepted = service
        .send(alice.clone(), serde_json::from_value(outgoing.clone()).unwrap())
        .await
        .unwrap();
    assert_eq!(accepted.conversation.draft.content.unwrap().text, "New typing");

    outgoing["operation_id"] = json!(uuid::Uuid::new_v4());
    outgoing["message_id"] = json!(uuid::Uuid::new_v4());
    outgoing["draft_version"] = json!("2");
    let cleared = service.send(alice, serde_json::from_value(outgoing).unwrap()).await.unwrap();
    assert_eq!(cleared.conversation.draft.version, "3");
    assert!(cleared.conversation.draft.content.is_none());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn reads_are_monotonic_and_close_reopens_with_the_personal_clear_cutoff(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool).await;
    let first = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let second = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let read = command(first.conversation.id, json!({"kind": "read", "through": "2"}));
    let read = service.command(bobby.clone(), read).await.unwrap();
    assert_eq!(read.conversation.unwrap().unread_count, "0");
    let old_read = command(first.conversation.id, json!({"kind": "read", "through": "1"}));
    let old_read = service.command(bobby.clone(), old_read).await.unwrap();
    assert_eq!(old_read.conversation.unwrap().read_through, "2");

    let close = command(first.conversation.id, json!({"kind": "close"}));
    let closed = service.command(bobby.clone(), close.clone()).await.unwrap();
    assert!(closed.conversation.is_none());
    assert!(service.command(bobby.clone(), close).await.unwrap().conversation.is_none());
    assert!(service.message(bobby.clone(), second.message.id).await.is_err());
    let reopened = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let history = service
        .history(
            bobby.clone(),
            HistoryQuery {
                conversation_id: first.conversation.id,
                unread: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(history.messages.len(), 1);
    assert_eq!(history.messages[0].id, reopened.message.id);
    assert_eq!(history.anchor_id, Some(reopened.message.id));
    let own = service
        .history(
            alice,
            HistoryQuery {
                conversation_id: first.conversation.id,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(own.messages.len(), 3);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn read_time_preserves_the_first_visible_read_for_the_author_only(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool.clone()).await;
    sqlx::query("UPDATE users SET presence_audience = 'everyone' WHERE id = $1")
        .bind(bobby.user_id)
        .execute(&pool)
        .await
        .unwrap();

    let hidden = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let visible = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let conversation_id = visible.conversation.id;
    let visible_id = visible.message.id;
    assert!(service.read_time(alice.clone(), visible_id).await.unwrap().read_at.is_none());
    let hide =
        command(conversation_id, json!({"kind": "hide_message", "message_id": hidden.message.id}));
    service.command(bobby.clone(), hide).await.unwrap();

    let read = command(conversation_id, json!({"kind": "read", "through": "2"}));
    service.command(bobby.clone(), read).await.unwrap();
    let observed = service.read_time(alice.clone(), visible_id).await.unwrap().read_at.unwrap();
    assert!(observed >= visible.message.created_at);
    assert!(service.read_time(alice.clone(), hidden.message.id).await.unwrap().read_at.is_none());
    let repeated = command(conversation_id, json!({"kind": "read", "through": "2"}));
    service.command(bobby.clone(), repeated).await.unwrap();
    assert_eq!(service.read_time(alice.clone(), visible_id).await.unwrap().read_at, Some(observed));
    assert!(matches!(
        service.read_time(bobby.clone(), visible_id).await,
        Err(AccountError::NotFound)
    ));

    sqlx::query("UPDATE users SET presence_audience = 'nobody' WHERE id = $1")
        .bind(bobby.user_id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        service.read_time(alice.clone(), visible_id).await,
        Err(AccountError::NotFound)
    ));
    sqlx::query("UPDATE users SET presence_audience = 'everyone' WHERE id = $1")
        .bind(bobby.user_id)
        .execute(&pool)
        .await
        .unwrap();
    let clear = command(conversation_id, json!({"kind": "clear"}));
    service.command(alice.clone(), clear).await.unwrap();
    assert!(matches!(service.read_time(alice, visible_id).await, Err(AccountError::NotFound)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn unread_history_starts_at_the_first_visible_incoming_message(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool).await;
    let read_message = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let conversation_id = read_message.conversation.id;
    let read = command(conversation_id, json!({"kind": "read", "through": "1"}));
    service.command(bobby.clone(), read).await.unwrap();

    let hidden = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let hide =
        command(conversation_id, json!({"kind": "hide_message", "message_id": hidden.message.id}));
    service.command(bobby.clone(), hide).await.unwrap();
    let expiry = command(conversation_id, json!({"kind": "expiry", "days": 1}));
    service.command(bobby.clone(), expiry).await.unwrap();
    service.send(bobby.clone(), send_input(alice.user_id)).await.unwrap();
    let first_unread = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    for _ in 0..4 {
        service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    }

    let unread_query = || HistoryQuery {
        conversation_id,
        unread: Some(true),
        limit: Some(3),
        ..Default::default()
    };
    let history = service.history(bobby.clone(), unread_query()).await.unwrap();
    assert_eq!(history.anchor_id, Some(first_unread.message.id));
    let sequences: Vec<_> =
        history.messages.iter().map(|message| message.sequence.as_str()).collect();
    assert_eq!(sequences, ["4", "5", "6"]);
    assert!(history.has_older);
    assert!(history.has_newer);

    let read = command(conversation_id, json!({"kind": "read", "through": "9"}));
    service.command(bobby.clone(), read).await.unwrap();
    let history = service.history(bobby, unread_query()).await.unwrap();
    assert_eq!(history.anchor_id, None);
    assert_eq!(history.messages.last().unwrap().sequence, "9");
    assert!(!history.has_newer);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn expiry_policy_emits_a_service_notice_and_only_dates_future_user_messages(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool).await;
    let first = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let expiry = command(first.conversation.id, json!({"kind": "expiry", "days": 1}));
    let changed = service.command(bobby.clone(), expiry).await.unwrap();
    assert_eq!(changed.conversation.unwrap().expiry_days, 1);
    assert_eq!(changed.message.unwrap().service_kind.as_deref(), Some("expiry_changed"));
    let next = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    assert!(next.message.expires_at.is_some());
    let original = service.message(alice, first.message.id).await.unwrap();
    assert!(original.expires_at.is_none());
    assert_eq!(next.conversation.unread_count, "0");
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn hidden_reply_targets_are_scrubbed_from_synced_drafts(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool).await;
    let sent = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let draft = command(
        sent.conversation.id,
        json!({
            "kind": "draft",
            "expected_version": "0",
            "content": {"schema_version": 1, "text": "A reply", "custom_emoji": []},
            "reply": {"message_id": sent.message.id, "quote": "Original"}
        }),
    );
    service.command(bobby.clone(), draft).await.unwrap();
    let hidden = command(
        sent.conversation.id,
        json!({
            "kind": "hide_message",
            "message_id": sent.message.id
        }),
    );
    service.command(bobby.clone(), hidden).await.unwrap();
    let snapshot = service.bootstrap(bobby).await.unwrap();
    let conversation =
        snapshot.conversations.iter().find(|item| item.id == sent.conversation.id).unwrap();
    assert!(conversation.draft.reply.as_ref().unwrap().quote.is_none());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn reopening_checks_capacity_and_rolls_back_without_revealing_cleared_history(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool.clone()).await;
    let sent = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    service
        .command(bobby.clone(), command(sent.conversation.id, json!({"kind": "close"})))
        .await
        .unwrap();
    sqlx::query(
        "WITH peers AS (
            INSERT INTO users (id, username, password_hash, display_name)
            SELECT gen_random_uuid(), 'capacity_' || number, 'unused', 'Peer'
            FROM generate_series(1, 200) AS number RETURNING id
         ), chats AS (
            INSERT INTO conversations (id, kind, participant_low, participant_high)
            SELECT gen_random_uuid(), 'direct', least($1, id), greatest($1, id) FROM peers
            RETURNING id
         ) INSERT INTO conversation_members (conversation_id, user_id) SELECT id, $1 FROM chats",
    )
    .bind(bobby.user_id)
    .execute(&pool)
    .await
    .unwrap();
    assert!(matches!(
        service.send(alice, send_input(bobby.user_id)).await,
        Err(AccountError::ConversationUnavailable)
    ));
    let retained = sqlx::query_as(
        "SELECT directory_active, clear_through FROM conversation_members
         WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(sent.conversation.id)
    .bind(bobby.user_id);
    let retained: (bool, i64) = retained.fetch_one(&pool).await.unwrap();
    assert_eq!(retained, (false, 1));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn independent_preference_commands_preserve_other_devices_fields(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool).await;
    let sent = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let archive = command(
        sent.conversation.id,
        json!({
            "kind": "preferences",
            "change": {"field": "archive", "is_archived": true}
        }),
    );
    let mute = command(
        sent.conversation.id,
        json!({
            "kind": "preferences",
            "change": {"field": "mute", "until": "2099-01-01T00:00:00Z"}
        }),
    );
    service.command(alice.clone(), archive).await.unwrap();
    let changed = service.command(alice, mute).await.unwrap().conversation.unwrap();
    assert!(changed.is_archived);
    assert!(changed.muted_until.is_some());
}
