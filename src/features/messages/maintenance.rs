//! Bounded message expiry and scheduled poll closure.

use sqlx::PgPool;
use uuid::Uuid;

use crate::features::{
    accounts::AccountError,
    conversations::access,
    media::references,
    messages::{
        checklists,
        commands::{advance_interaction, repair_unread},
        polls,
    },
    sync::changes::{self, ChangeGroup},
};

/// Expire one message while preserving the conversation/account/feed lock order used by writes.
pub async fn expire_one(pool: &PgPool) -> Result<bool, AccountError> {
    let mut transaction = pool.begin().await?;
    let conversation = sqlx::query_as::<_, access::LockedConversation>(
        "SELECT conversation.* FROM conversations conversation WHERE EXISTS (
            SELECT 1 FROM messages message WHERE message.conversation_id = conversation.id
              AND message.deleted_at IS NULL AND message.expires_at <= now()
         ) ORDER BY conversation.id FOR UPDATE SKIP LOCKED LIMIT 1",
    )
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(conversation) = conversation else {
        return Ok(false);
    };
    access::lock_participants(&mut transaction, &conversation)
        .await
        .map_err(|error| error.into_public())?;
    let message_id: Uuid = sqlx::query_scalar(
        "UPDATE messages SET deleted_at = now(), version = version + 1, is_pinned = false,
             content = '{\"schema_version\":1,\"text\":\"\",\"custom_emoji\":[]}'::jsonb,
             body = NULL, forwarded_from = NULL, reply_quote = NULL
         WHERE id = (SELECT id FROM messages WHERE conversation_id = $1
             AND deleted_at IS NULL AND expires_at <= now() ORDER BY sequence LIMIT 1)
         RETURNING id",
    )
    .bind(conversation.id)
    .fetch_one(&mut *transaction)
    .await?;
    references::detach_message(&mut transaction, message_id).await?;
    super::link_previews::revoke(&mut transaction, message_id).await?;
    polls::delete(&mut transaction, message_id).await?;
    checklists::delete(&mut transaction, message_id).await?;
    sqlx::query("UPDATE messages SET reply_quote = NULL WHERE reply_id = $1")
        .bind(message_id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM message_reactions WHERE message_id = $1")
        .bind(message_id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("UPDATE conversations SET version = version + 1 WHERE id = $1")
        .bind(conversation.id)
        .execute(&mut *transaction)
        .await?;
    repair_unread(&mut transaction, conversation.id).await?;
    let participants = access::participants(&mut transaction, &conversation).await?;
    changes::append(
        &mut transaction,
        ChangeGroup {
            participants: &participants,
            conversation_id: conversation.id,
            message_id: Some(message_id),
        },
    )
    .await?;
    transaction.commit().await?;

    Ok(true)
}

/// Publish one due poll closure under the same locks used by voting and deletion.
pub async fn close_due_poll(pool: &PgPool) -> Result<bool, AccountError> {
    let mut transaction = pool.begin().await?;
    let lock = sqlx::query_as::<_, access::LockedConversation>(
        "SELECT conversation.* FROM conversations conversation WHERE EXISTS (
             SELECT 1 FROM message_polls poll JOIN messages message ON message.id = poll.message_id
             WHERE message.conversation_id = conversation.id AND message.deleted_at IS NULL
               AND poll.closed_at IS NULL AND poll.closes_at <= clock_timestamp()
         ) ORDER BY conversation.id FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    let Some(conversation) = lock.fetch_optional(&mut *transaction).await? else {
        return Ok(false);
    };
    access::lock_participants(&mut transaction, &conversation)
        .await
        .map_err(|error| error.into_public())?;

    // The conversation lock prevents a user command from racing this deadline publication.
    let due = sqlx::query_scalar(
        "SELECT poll.message_id FROM message_polls poll JOIN messages message
         ON message.id = poll.message_id WHERE message.conversation_id = $1
           AND message.deleted_at IS NULL AND poll.closed_at IS NULL
           AND poll.closes_at <= clock_timestamp() ORDER BY poll.closes_at, poll.message_id LIMIT 1",
    );
    let Some(message_id) = due.bind(conversation.id).fetch_optional(&mut *transaction).await?
    else {
        return Ok(false);
    };
    polls::close_poll(&mut transaction, message_id).await?;
    advance_interaction(&mut transaction, message_id).await?;
    let participants = access::participants(&mut transaction, &conversation).await?;
    let change = ChangeGroup {
        participants: &participants,
        conversation_id: conversation.id,
        message_id: Some(message_id),
    };
    changes::append(&mut transaction, change).await?;
    transaction.commit().await?;

    Ok(true)
}
