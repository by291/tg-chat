//! Bounded content expiry and contiguous feed retention; reads enforce expiry independently.

use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    accounts::AccountError,
    conversations::access,
    messages::commands::repair_unread,
    sync::changes::{self, ChangeGroup},
};

const CHANGE_RETENTION_DAYS: i32 = 30;
const RETENTION_BATCH_SIZE: i64 = 1000;

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
             reply_quote = NULL
         WHERE id = (SELECT id FROM messages WHERE conversation_id = $1
             AND deleted_at IS NULL AND expires_at <= now() ORDER BY sequence LIMIT 1)
         RETURNING id",
    )
    .bind(conversation.id)
    .fetch_one(&mut *transaction)
    .await?;
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

/// Prune one account's old contiguous prefix and advance its floor in the same transaction.
pub async fn prune_one(pool: &PgPool) -> Result<bool, AccountError> {
    let mut transaction = pool.begin().await?;
    let candidate: Option<Uuid> = sqlx::query_scalar(
        "SELECT head.user_id FROM sync_heads head WHERE EXISTS (
            SELECT 1 FROM personal_changes change WHERE change.user_id = head.user_id
              AND change.created_at < now() - $1 * interval '1 day'
              AND change.position = head.retained_floor + 1
         ) ORDER BY head.user_id FOR UPDATE SKIP LOCKED LIMIT 1",
    )
    .bind(CHANGE_RETENTION_DAYS)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(user_id) = candidate else {
        return Ok(false);
    };
    // Transaction start timestamps can differ from commit order; stop before the first recent row.
    let floor = sqlx::query_scalar(
        "SELECT least(head.retained_floor + $3, COALESCE((SELECT min(position) - 1
            FROM personal_changes WHERE user_id = $1
              AND created_at >= now() - $2 * interval '1 day'), head.position))
         FROM sync_heads head WHERE head.user_id = $1",
    )
    .bind(user_id)
    .bind(CHANGE_RETENTION_DAYS)
    .bind(RETENTION_BATCH_SIZE);
    let floor: i64 = floor.fetch_one(&mut *transaction).await?;
    sqlx::query("DELETE FROM personal_changes WHERE user_id = $1 AND position <= $2")
        .bind(user_id)
        .bind(floor)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("UPDATE sync_heads SET retained_floor = $2 WHERE user_id = $1")
        .bind(user_id)
        .bind(floor)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;

    Ok(true)
}
