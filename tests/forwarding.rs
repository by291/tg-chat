#[allow(dead_code)]
mod support;

use std::time::Duration;

use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};
use tg_chat::{
    accounts::{AccountError, AccountService, AccountSettings},
    messages::{ForwardBatch, MessageService},
};
use uuid::Uuid;

use support::messaging::{command, send_input};

const LOCK_WAIT_TIMEOUT: Duration = Duration::from_secs(5);
const LOCK_POLL_INTERVAL: Duration = Duration::from_millis(10);

struct ForwardFixture {
    service: MessageService,
    sender: tg_chat::accounts::Actor,
    forwarder: tg_chat::accounts::Actor,
    receiver: tg_chat::accounts::Actor,
    source: tg_chat::messages::SendReceipt,
}

async fn forward_fixture(pool: PgPool) -> ForwardFixture {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let sender = support::account(&accounts, "original_author").await;
    let forwarder = support::account(&accounts, "forwarder").await;
    let receiver = support::account(&accounts, "new_recipient").await;
    let service = MessageService::new(accounts);

    let input = send_input(forwarder.user_id);
    let source = service.send(sender.clone(), input).await.unwrap();

    ForwardFixture {
        service,
        sender,
        forwarder,
        receiver,
        source,
    }
}

fn batch(fixture: &ForwardFixture) -> ForwardBatch {
    serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "destination": {"kind": "recipient", "user_id": fixture.receiver.user_id},
        "items": [{
            "source_message_id": fixture.source.message.id,
            "message_id": Uuid::new_v4(),
        }],
    }))
    .unwrap()
}

async fn wait_for_blocked_query(pool: &PgPool, query_pattern: &str) {
    let query = "SELECT EXISTS (SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1)";

    tokio::time::timeout(LOCK_WAIT_TIMEOUT, async {
        loop {
            let blocked = sqlx::query_scalar::<_, bool>(query).bind(query_pattern);
            if blocked.fetch_one(pool).await.unwrap() {
                break;
            }

            tokio::time::sleep(LOCK_POLL_INTERVAL).await;
        }
    })
    .await
    .expect("the operation waits for the held lock");
}

async fn lock_conversation(pool: &PgPool, conversation_id: Uuid) -> Transaction<'static, Postgres> {
    let mut held = pool.begin().await.unwrap();
    let lock = sqlx::query("SELECT id FROM conversations WHERE id = $1 FOR UPDATE");
    lock.bind(conversation_id).execute(&mut *held).await.unwrap();

    held
}

async fn expire_while_conversation_is_locked(
    pool: &PgPool,
    mut held: Transaction<'_, Postgres>,
    message_id: Uuid,
) {
    // Wait until the competing transaction has already captured its start time.
    wait_for_blocked_query(pool, "SELECT * FROM conversations WHERE id = ANY%").await;
    let expire = sqlx::query("UPDATE messages SET expires_at = clock_timestamp() WHERE id = $1");
    expire.bind(message_id).execute(&mut *held).await.unwrap();
    held.commit().await.unwrap();
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn forward_retry_after_source_deletion_returns_the_same_batch(pool: PgPool) {
    let fixture = forward_fixture(pool.clone()).await;
    let request = batch(&fixture);
    let first = fixture.service.forward(fixture.forwarder.clone(), request.clone()).await.unwrap();

    let delete = command(
        fixture.source.conversation.id,
        json!({"kind": "delete", "message_id": fixture.source.message.id}),
    );
    fixture.service.command(fixture.sender, delete).await.unwrap();
    let replay = fixture.service.forward(fixture.forwarder, request).await.unwrap();
    assert_eq!(replay.message_ids, first.message_ids);

    let copied = fixture.service.message(fixture.receiver, replay.message_ids[0]).await.unwrap();
    assert_eq!(copied.content.text, "Original text");
    assert_eq!(copied.forwarded_from.as_deref(), Some("original_author"));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM messages WHERE conversation_id = $1")
        .bind(copied.conversation_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn protected_source_rejects_the_entire_destination_batch(pool: PgPool) {
    let fixture = forward_fixture(pool.clone()).await;
    let allowed = send_input(fixture.forwarder.user_id);
    let allowed = fixture.service.send(fixture.receiver.clone(), allowed).await.unwrap();
    let disable = command(
        fixture.source.conversation.id,
        json!({"kind": "set_forwarding_policy", "is_enabled": false}),
    );
    fixture.service.command(fixture.sender.clone(), disable).await.unwrap();
    let mut request = batch(&fixture);
    request.items.insert(
        0,
        tg_chat::messages::ForwardItem {
            source_message_id: allowed.message.id,
            message_id: Uuid::new_v4(),
        },
    );
    let result = fixture.service.forward(fixture.forwarder.clone(), request).await;

    assert!(matches!(result, Err(AccountError::ConversationUnavailable)));
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM messages").fetch_one(&pool).await.unwrap();
    assert_eq!(count, 2);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and S3 storage"]
async fn forwarded_file_survives_source_deletion_and_collection(pool: PgPool) {
    use tg_chat::media::{
        AttachmentInput, DownloadReference, MediaCleanup, MediaVariant, MessageDownload,
    };

    let mut fixture = forward_fixture(pool.clone()).await;
    let file = support::media::prepared_document(&pool, &fixture.sender).await;
    let mut original = send_input(fixture.forwarder.user_id);
    original.attachments.push(AttachmentInput {
        occurrence_id: Uuid::new_v4(),
        file_id: file,
    });
    fixture.source = fixture.service.send(fixture.sender.clone(), original).await.unwrap();
    let forwarded =
        fixture.service.forward(fixture.forwarder.clone(), batch(&fixture)).await.unwrap();

    let delete = command(
        fixture.source.conversation.id,
        json!({"kind": "delete", "message_id": fixture.source.message.id}),
    );
    fixture.service.command(fixture.sender, delete).await.unwrap();

    let cleanup = MediaCleanup::new(pool.clone(), support::media::storage_settings());
    cleanup.process_next().await.unwrap();
    let copy =
        fixture.service.message(fixture.receiver.clone(), forwarded.message_ids[0]).await.unwrap();
    let reference = DownloadReference::Message(MessageDownload {
        message_id: copy.id,
        occurrence_id: copy.attachments[0].occurrence_id,
        variant: MediaVariant::Original,
    });
    let accounts = AccountService::new(pool, AccountSettings::default());
    let uploads = support::media::test_upload_service(accounts);
    let signed = uploads.sign_download(&fixture.receiver, reference).await.unwrap();

    let bytes = reqwest::get(signed.url).await.unwrap().bytes().await.unwrap();
    assert_eq!(bytes.as_ref(), b"a private document");
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn disabling_again_requires_both_direct_participants_to_renew_consent(pool: PgPool) {
    let fixture = forward_fixture(pool).await;
    let conversation = fixture.source.conversation.id;
    let setting = |is_enabled: bool| {
        command(conversation, json!({"kind": "set_forwarding_policy", "is_enabled": is_enabled}))
    };
    fixture.service.command(fixture.sender.clone(), setting(false)).await.unwrap();
    fixture.service.command(fixture.sender.clone(), setting(true)).await.unwrap();
    fixture.service.command(fixture.forwarder.clone(), setting(false)).await.unwrap();
    fixture.service.command(fixture.forwarder.clone(), setting(true)).await.unwrap();

    let denied = fixture.service.forward(fixture.forwarder.clone(), batch(&fixture)).await;
    assert!(matches!(denied, Err(AccountError::ConversationUnavailable)));
    fixture.service.command(fixture.sender.clone(), setting(true)).await.unwrap();
    fixture.service.forward(fixture.forwarder.clone(), batch(&fixture)).await.unwrap();
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn forwarded_quiz_contains_only_its_read_only_question_and_options(pool: PgPool) {
    let mut fixture = forward_fixture(pool).await;
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let input = send_input(fixture.forwarder.user_id);
    let mut input = serde_json::to_value(input).unwrap();
    input["body"] = json!({
        "kind": "poll",
        "question": "Which trail stays open?",
        "options": [{"id": first, "text": "South"}, {"id": second, "text": "North"}],
        "is_anonymous": true,
        "hide_results_until_close": true,
        "quiz": {"correct_option_ids": [first], "explanation": "Private answer explanation"},
    });
    let input = serde_json::from_value(input).unwrap();
    fixture.source = fixture.service.send(fixture.sender.clone(), input).await.unwrap();
    let receipt =
        fixture.service.forward(fixture.forwarder.clone(), batch(&fixture)).await.unwrap();
    let copy =
        fixture.service.message(fixture.receiver.clone(), receipt.message_ids[0]).await.unwrap();
    let body = serde_json::to_value(&copy.body).unwrap();

    assert_eq!(
        body,
        json!({
            "kind": "poll_snapshot",
            "question": "Which trail stays open?",
            "options": [{"id": first, "text": "South"}, {"id": second, "text": "North"}],
        })
    );
    let action = json!({"kind": "vote_poll", "message_id": copy.id, "option_ids": [first]});
    let action = command(copy.conversation_id, action);
    assert!(matches!(
        fixture.service.command(fixture.receiver, action).await,
        Err(AccountError::NotFound)
    ));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn batch_delete_rolls_back_if_a_selected_message_belongs_to_someone_else(pool: PgPool) {
    let fixture = forward_fixture(pool).await;
    let own = send_input(fixture.sender.user_id);
    let own = fixture.service.send(fixture.forwarder.clone(), own).await.unwrap();
    let action = json!({
        "kind": "batch_delete",
        "message_ids": [own.message.id, fixture.source.message.id],
    });
    let action = command(own.conversation.id, action);
    let outcome = fixture.service.command(fixture.forwarder.clone(), action).await;

    assert!(matches!(outcome, Err(AccountError::NotFound)));
    assert!(fixture.service.message(fixture.sender, own.message.id).await.is_ok());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn a_forward_cannot_copy_a_source_that_expires_while_waiting_for_the_chat_lock(pool: PgPool) {
    let fixture = forward_fixture(pool.clone()).await;
    let held = lock_conversation(&pool, fixture.source.conversation.id).await;
    let request = batch(&fixture);
    let actor = fixture.forwarder.clone();
    let forwarding = fixture.service.clone();
    let operation = tokio::spawn(async move { forwarding.forward(actor, request).await });

    expire_while_conversation_is_locked(&pool, held, fixture.source.message.id).await;

    assert!(matches!(operation.await.unwrap(), Err(AccountError::NotFound)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn a_command_cannot_react_to_a_message_that_expires_while_waiting(pool: PgPool) {
    let fixture = forward_fixture(pool.clone()).await;
    let held = lock_conversation(&pool, fixture.source.conversation.id).await;
    let message_id = fixture.source.message.id;
    let action = command(
        fixture.source.conversation.id,
        json!({
            "kind": "reaction",
            "message_id": message_id,
            "emoji": "👍",
            "is_selected": true,
        }),
    );
    let actor = fixture.forwarder.clone();
    let service = fixture.service.clone();
    let operation = tokio::spawn(async move { service.command(actor, action).await });

    expire_while_conversation_is_locked(&pool, held, message_id).await;

    assert!(matches!(operation.await.unwrap(), Err(AccountError::NotFound)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and S3 storage"]
async fn batch_delete_waits_for_the_lower_file_before_locking_the_higher_file(pool: PgPool) {
    use tg_chat::media::AttachmentInput;

    let fixture = forward_fixture(pool.clone()).await;
    let first = support::media::prepared_document(&pool, &fixture.sender).await;
    let second = support::media::prepared_document(&pool, &fixture.sender).await;
    let lower_file = first.min(second);
    let higher_file = first.max(second);
    let mut message_ids = Vec::new();
    for file_id in [higher_file, lower_file] {
        let mut input = send_input(fixture.forwarder.user_id);
        input.attachments.push(AttachmentInput {
            occurrence_id: Uuid::new_v4(),
            file_id,
        });
        let message = fixture.service.send(fixture.sender.clone(), input).await.unwrap();
        message_ids.push(message.message.id);
    }

    let mut held = pool.begin().await.unwrap();
    let lock = sqlx::query("SELECT id FROM media_files WHERE id = $1 FOR UPDATE");
    lock.bind(lower_file).execute(&mut *held).await.unwrap();
    let action = command(
        fixture.source.conversation.id,
        json!({"kind": "batch_delete", "message_ids": message_ids}),
    );
    let service = fixture.service.clone();
    let actor = fixture.sender.clone();
    let deletion = tokio::spawn(async move { service.command(actor, action).await });

    // A batch waiting on the lower file must leave the higher file free for other transactions.
    wait_for_blocked_query(&pool, "SELECT%FROM media_files%FOR UPDATE%").await;
    let probe = sqlx::query("SELECT id FROM media_files WHERE id = $1 FOR UPDATE NOWAIT");
    probe.bind(higher_file).execute(&pool).await.unwrap();
    held.commit().await.unwrap();

    deletion.await.unwrap().unwrap();
}
