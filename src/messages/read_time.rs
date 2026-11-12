use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgConnection;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{MessageService, commands::CommandContext, projection};
use crate::accounts::{AccountError, Actor};

const READ_TIME_WINDOW_DAYS: i32 = 7;

#[derive(Serialize, ToSchema, sqlx::FromRow)]
pub struct MessageReadTime {
    pub read_at: Option<DateTime<Utc>>,
}

/// Record first reads before advancing the cursor in the same locked conversation transaction.
pub(crate) async fn record_first_reads(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
    sequence: i64,
) -> Result<(), sqlx::Error> {
    if context.conversation.kind != "direct" {
        return Ok(());
    }

    // Only new incoming messages visible to this reader can acquire a read time.
    let update = sqlx::query(
        "UPDATE messages message SET first_read_at = statement_timestamp()
         FROM conversation_members reader
         WHERE reader.conversation_id = $1 AND reader.user_id = $2
           AND message.conversation_id = reader.conversation_id
           AND message.sequence > greatest(reader.read_through, reader.clear_through)
           AND message.sequence <= $3 AND message.author_id <> reader.user_id
           AND message.first_read_at IS NULL AND message.deleted_at IS NULL
           AND message.service_kind IS NULL
           AND message.created_at > statement_timestamp() - $4 * interval '1 day'
           AND (message.expires_at IS NULL OR message.expires_at > statement_timestamp())
           AND NOT EXISTS (SELECT 1 FROM hidden_messages hidden
               WHERE hidden.user_id = reader.user_id AND hidden.message_id = message.id)",
    );
    let update = update.bind(context.conversation.id).bind(context.actor.user_id);
    let update = update.bind(sequence).bind(READ_TIME_WINDOW_DAYS);
    update.execute(connection).await?;

    Ok(())
}

impl MessageService {
    /// Read the exact timestamp only for a recent, visible outgoing private message.
    pub async fn read_time(
        &self,
        actor: Actor,
        message_id: Uuid,
    ) -> Result<MessageReadTime, AccountError> {
        let mut transaction = self.snapshot(&actor).await?;
        // Exact read times expose activity, so apply the recipient's current presence audience.
        let mut statement = sqlx::QueryBuilder::new(
            "SELECT message.first_read_at AS read_at FROM messages message
             JOIN conversations conversation ON conversation.id = message.conversation_id
             JOIN users recipient ON recipient.id = CASE
                 WHEN conversation.participant_low = message.author_id
                 THEN conversation.participant_high ELSE conversation.participant_low END
             WHERE conversation.kind = 'direct'
               AND message.author_id IN (
                   conversation.participant_low, conversation.participant_high)
               AND NOT recipient.is_suspended
               AND (recipient.presence_audience = 'everyone' OR
                   (recipient.presence_audience = 'contacts' AND EXISTS (
                       SELECT 1 FROM contacts WHERE owner_id = recipient.id
                         AND target_id = message.author_id)))
               AND NOT EXISTS (SELECT 1 FROM blocks
                   WHERE (owner_id = recipient.id AND target_id = message.author_id)
                      OR (owner_id = message.author_id AND target_id = recipient.id))
               AND message.service_kind IS NULL AND message.id = ",
        );
        statement.push_bind(message_id);
        statement.push(" AND message.author_id = ").push_bind(actor.user_id);
        statement.push(" AND message.created_at > now() - ");
        statement.push_bind(READ_TIME_WINDOW_DAYS).push(" * interval '1 day'");
        projection::restrict_visible(&mut statement, actor.user_id);

        let read_time = statement
            .build_query_as()
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or(AccountError::NotFound)?;
        transaction.commit().await?;

        Ok(read_time)
    }
}
