#[allow(dead_code)]
mod support;

use serde_json::json;
use sqlx::PgPool;
use tg_chat::{
    accounts::{AccountError, AccountService, AccountSettings, Actor},
    messages::{MessageCommand, MessageService, SendMessage},
};
use uuid::Uuid;

fn send_input(recipient: Uuid) -> SendMessage {
    serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "message_id": Uuid::new_v4(),
        "destination": {"kind": "recipient", "user_id": recipient},
        "content": {
            "schema_version": 1,
            "text": "Original text",
            "custom_emoji": []
        }
    }))
    .unwrap()
}

fn command(conversation_id: Uuid, action: serde_json::Value) -> MessageCommand {
    serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "conversation_id": conversation_id,
        "action": action
    }))
    .unwrap()
}

async fn fixture(pool: PgPool) -> (MessageService, Actor, Actor) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let alice = support::account(&accounts, "alice").await;
    let bobby = support::account(&accounts, "bobby").await;

    (MessageService::new(accounts), alice, bobby)
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn edits_require_author_and_content_version_but_reactions_do_not_conflict(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool).await;
    let sent = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let edit = command(
        sent.conversation.id,
        json!({
            "kind": "edit",
            "message_id": sent.message.id,
            "expected_version": "1",
            "content": {
                "schema_version": 1,
                "text": "Edited text",
                "custom_emoji": []
            }
        }),
    );
    assert!(matches!(
        service.command(bobby.clone(), edit.clone()).await,
        Err(AccountError::NotFound)
    ));

    let reaction = command(
        sent.conversation.id,
        json!({
            "kind": "reaction",
            "message_id": sent.message.id,
            "emoji": "👍",
            "is_selected": true
        }),
    );
    service.command(bobby.clone(), reaction).await.unwrap();
    let edited = service.command(alice.clone(), edit.clone()).await.unwrap();
    assert_eq!(edited.message.as_ref().unwrap().version, "2");
    assert_eq!(edited.message.as_ref().unwrap().reactions.len(), 1);
    let replay = service.command(alice.clone(), edit.clone()).await.unwrap();
    assert_eq!(replay.message.unwrap().version, "2");

    let mut stale = edit;
    stale.operation_id = Uuid::new_v4();
    assert!(matches!(service.command(alice, stale).await, Err(AccountError::MessageConflict)));
    let current = service.message(bobby, sent.message.id).await.unwrap();
    assert_eq!(current.content.text, "Edited text");
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn deletion_scrubs_replies_and_replay_never_recreates_content(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool.clone()).await;
    let outgoing = send_input(bobby.user_id);
    let sent = service.send(alice.clone(), outgoing.clone()).await.unwrap();
    let mut reply = serde_json::to_value(send_input(alice.user_id)).unwrap();
    reply["reply"] = json!({"message_id": sent.message.id, "quote": "Original"});
    let reply = service.send(bobby.clone(), serde_json::from_value(reply).unwrap()).await.unwrap();
    let delete = command(
        sent.conversation.id,
        json!({
            "kind": "delete",
            "message_id": sent.message.id
        }),
    );
    assert!(matches!(
        service.command(bobby.clone(), delete.clone()).await,
        Err(AccountError::NotFound)
    ));
    service.command(alice.clone(), delete).await.unwrap();

    assert!(matches!(
        service.message(bobby.clone(), sent.message.id).await,
        Err(AccountError::NotFound)
    ));
    let projection = service.message(bobby, reply.message.id).await.unwrap();
    let target = projection.reply.unwrap();
    assert!(target.is_unavailable);
    assert!(target.quote.is_none());
    let replay = service.send(alice, outgoing).await.unwrap();
    assert!(replay.message.is_deleted);
    assert!(replay.message.content.text.is_empty());
    let stored: String = sqlx::query_scalar("SELECT content->>'text' FROM messages WHERE id = $1")
        .bind(sent.message.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(stored.is_empty());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn personal_hides_and_expiry_remove_content_before_cleanup(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool.clone()).await;
    let before = service.bootstrap(bobby.clone()).await.unwrap();
    let sent = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let hide = command(
        sent.conversation.id,
        json!({
            "kind": "hide_message",
            "message_id": sent.message.id
        }),
    );
    service.command(bobby.clone(), hide).await.unwrap();
    assert!(matches!(
        service.message(bobby.clone(), sent.message.id).await,
        Err(AccountError::NotFound)
    ));
    assert!(service.message(alice.clone(), sent.message.id).await.is_ok());
    let changes = service
        .sync(
            bobby.clone(),
            tg_chat::sync::SyncQuery {
                cursor: before.cursor,
                limit: None,
            },
        )
        .await
        .unwrap();
    assert!(changes.groups.iter().any(|group| group.removed_message_id == Some(sent.message.id)));

    let expiry = sqlx::query(
        "UPDATE messages SET expires_at = now() - interval '1 second'
                             WHERE id = $1",
    )
    .bind(sent.message.id);
    expiry.execute(&pool).await.unwrap();
    assert!(matches!(service.message(alice, sent.message.id).await, Err(AccountError::NotFound)));
    let history = service
        .history(
            bobby,
            tg_chat::messages::HistoryQuery {
                conversation_id: sent.conversation.id,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(history.messages.is_empty());
    assert!(!history.has_newer);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn hidden_and_deleted_messages_leave_no_directory_preview_or_unread_count(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool).await;
    let sent = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let hide = command(
        sent.conversation.id,
        json!({
            "kind": "hide_message",
            "message_id": sent.message.id
        }),
    );
    service.command(bobby.clone(), hide).await.unwrap();
    let bootstrap = service.bootstrap(bobby).await.unwrap();
    let directory =
        bootstrap.conversations.iter().find(|item| item.id == sent.conversation.id).unwrap();
    assert!(directory.summary_text.is_empty());
    assert_eq!(directory.unread_count, "0");

    let delete = command(
        sent.conversation.id,
        json!({
            "kind": "delete",
            "message_id": sent.message.id
        }),
    );
    service.command(alice.clone(), delete).await.unwrap();
    let bootstrap = service.bootstrap(alice).await.unwrap();
    let directory =
        bootstrap.conversations.iter().find(|item| item.id == sent.conversation.id).unwrap();
    assert!(directory.summary_text.is_empty());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn concurrent_edits_have_one_winner_and_operation_ids_cannot_cross_command_kinds(
    pool: PgPool,
) {
    let (service, alice, bobby) = fixture(pool).await;
    let outgoing = send_input(bobby.user_id);
    let sent = service.send(alice.clone(), outgoing.clone()).await.unwrap();
    let first = command(
        sent.conversation.id,
        json!({
            "kind": "edit",
            "message_id": sent.message.id,
            "expected_version": "1",
            "content": {
                "schema_version": 1,
                "text": "First editor",
                "custom_emoji": []
            }
        }),
    );
    let mut second = first.clone();
    second.operation_id = Uuid::new_v4();
    let (first_result, second_result) = tokio::join!(
        service.command(alice.clone(), first),
        service.command(alice.clone(), second),
    );
    assert_ne!(first_result.is_ok(), second_result.is_ok());

    let mut reused = command(
        sent.conversation.id,
        json!({
            "kind": "delete",
            "message_id": sent.message.id
        }),
    );
    reused.operation_id = outgoing.operation_id;
    assert!(matches!(service.command(alice, reused).await, Err(AccountError::MessageConflict)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn reply_targets_and_neighborhoods_require_visible_same_conversation_content(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool).await;
    let first = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let second = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let third = service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let page = service
        .history(
            bobby.clone(),
            tg_chat::messages::HistoryQuery {
                conversation_id: first.conversation.id,
                around: Some(second.message.id),
                limit: Some(3),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(page.messages.len(), 3);
    assert_eq!(page.messages[1].id, second.message.id);
    assert_eq!(page.messages[2].id, third.message.id);

    let mut invalid = serde_json::to_value(send_input(bobby.user_id)).unwrap();
    invalid["reply"] = json!({"message_id": first.message.id, "quote": "invented excerpt"});
    assert!(matches!(
        service.send(alice.clone(), serde_json::from_value(invalid.clone()).unwrap()).await,
        Err(AccountError::Validation(_))
    ));
    invalid["reply"]["quote"] = json!("Original");
    invalid["destination"] = json!({"kind": "saved"});
    assert!(matches!(
        service.send(alice, serde_json::from_value(invalid).unwrap()).await,
        Err(AccountError::NotFound)
    ));

    let hide = command(
        first.conversation.id,
        json!({
            "kind": "hide_message",
            "message_id": second.message.id
        }),
    );
    service.command(bobby.clone(), hide).await.unwrap();
    assert!(matches!(
        service
            .history(
                bobby,
                tg_chat::messages::HistoryQuery {
                    conversation_id: first.conversation.id,
                    around: Some(second.message.id),
                    ..Default::default()
                }
            )
            .await,
        Err(AccountError::NotFound)
    ));
}
