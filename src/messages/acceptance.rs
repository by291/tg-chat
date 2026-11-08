use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

use super::{CanonicalMessage, SendMessage, SendReceipt, service::AcceptanceError};
use crate::{
    accounts::{AccountError, Actor},
    conversations::{self, access::LockedConversation},
    sync::changes::{self, ChangeGroup},
};

pub(crate) const MESSAGE_SELECT: &str =
    "SELECT message.id, message.conversation_id, message.author_id,
            author.display_name AS author_name, message.sequence::text,
            message.version::text, message.created_at, message.edited_at, message.expires_at,
            message.interaction_version::text, message.is_pinned, message.service_kind,
            message.reply_id, message.reply_quote,
            (message.deleted_at IS NOT NULL OR message.expires_at <= now()) IS TRUE AS is_deleted,
            CASE WHEN message.deleted_at IS NOT NULL OR message.expires_at <= now()
                THEN '{\"schema_version\":1,\"text\":\"\",\"custom_emoji\":[]}'::jsonb
                ELSE message.content END AS content
     FROM messages message JOIN users author ON author.id = message.author_id";

pub(crate) struct IdentityCheck<'a> {
    pub actor: &'a Actor,
    pub input: &'a SendMessage,
    pub payload_hash: &'a [u8],
}

pub(crate) struct NewMessage<'a> {
    pub actor: &'a Actor,
    pub input: &'a SendMessage,
    pub payload_hash: &'a [u8],
    pub conversation: &'a LockedConversation,
}

#[derive(FromRow)]
struct Identity {
    id: Uuid,
    author_id: Uuid,
    operation_id: Uuid,
    payload_hash: Vec<u8>,
}

/// Reconcile against permanent bindings even after an operation receipt has been pruned.
pub(crate) async fn reconcile(
    connection: &mut PgConnection,
    check: IdentityCheck<'_>,
) -> Result<Option<SendReceipt>, AcceptanceError> {
    let query = sqlx::query_as::<_, Identity>(
        "SELECT * FROM message_identities
         WHERE id = $1 OR (author_id = $2 AND operation_id = $3)",
    )
    .bind(check.input.message_id)
    .bind(check.actor.user_id)
    .bind(check.input.operation_id);
    let identities = query.fetch_all(&mut *connection).await?;
    if identities.is_empty() {
        return Ok(None);
    }

    let identity = &identities[0];
    let is_matching = identities.len() == 1
        && identity.id == check.input.message_id
        && identity.author_id == check.actor.user_id
        && identity.operation_id == check.input.operation_id
        && identity.payload_hash == check.payload_hash;
    if !is_matching {
        return Err(AccountError::MessageConflict.into());
    }

    Ok(Some(receipt(connection, check.actor.user_id, identity.id).await?))
}

/// Store identity, message, personal summary, receipt, and feed intent in the caller's transaction.
pub(crate) async fn insert(
    connection: &mut PgConnection,
    message: NewMessage<'_>,
) -> Result<(), AcceptanceError> {
    let identity = sqlx::query(
        "INSERT INTO message_identities (id, author_id, conversation_id, operation_id, payload_hash)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(message.input.message_id)
    .bind(message.actor.user_id);
    let identity = identity
        .bind(message.conversation.id)
        .bind(message.input.operation_id)
        .bind(message.payload_hash);
    identity.execute(&mut *connection).await?;

    let sequence: i64 = sqlx::query_scalar(
        "UPDATE conversations SET last_sequence = last_sequence + 1, version = version + 1,
         summary_text = $2, updated_at = now() WHERE id = $1 RETURNING last_sequence",
    )
    .bind(message.conversation.id)
    .bind(&message.input.content.text)
    .fetch_one(&mut *connection)
    .await?;
    let insert = sqlx::query(
        "INSERT INTO messages (id, conversation_id, author_id, sequence, content)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(message.input.message_id)
    .bind(message.conversation.id);
    let insert = insert
        .bind(message.actor.user_id)
        .bind(sequence)
        .bind(sqlx::types::Json(&message.input.content));
    insert.execute(&mut *connection).await?;
    sqlx::query(
        "UPDATE conversation_members SET unread_count = unread_count + 1
         WHERE conversation_id = $1 AND user_id != $2",
    )
    .bind(message.conversation.id)
    .bind(message.actor.user_id)
    .execute(&mut *connection)
    .await?;
    let receipt_insert = sqlx::query(
        "INSERT INTO operation_receipts (actor_id, operation_id, message_id) VALUES ($1, $2, $3)",
    )
    .bind(message.actor.user_id)
    .bind(message.input.operation_id)
    .bind(message.input.message_id);
    receipt_insert.execute(&mut *connection).await?;
    if let Some(reply) = &message.input.reply {
        let mut statement = sqlx::QueryBuilder::new(
            "SELECT message.content->>'text' FROM messages message WHERE message.id = ",
        );
        statement.push_bind(reply.message_id);
        statement.push(" AND message.conversation_id = ").push_bind(message.conversation.id);
        super::projection::restrict_visible(&mut statement, message.actor.user_id);
        let source: String = statement
            .build_query_scalar()
            .fetch_optional(&mut *connection)
            .await?
            .ok_or(AccountError::NotFound)?;
        let is_invalid_quote =
            reply.quote.as_ref().is_some_and(|quote| quote.is_empty() || !source.contains(quote));
        if is_invalid_quote {
            return Err(AccountError::Validation("quote must occur in the reply target").into());
        }
        let update =
            sqlx::query("UPDATE messages SET reply_id = $2, reply_quote = $3 WHERE id = $1")
                .bind(message.input.message_id)
                .bind(reply.message_id)
                .bind(&reply.quote);
        update.execute(&mut *connection).await?;
    }
    sqlx::query(
        "UPDATE messages SET expires_at = CASE WHEN conversation.expiry_days = 0 THEN NULL
            ELSE messages.created_at + conversation.expiry_days * interval '1 day' END
         FROM conversations conversation
         WHERE messages.id = $1 AND conversation.id = messages.conversation_id",
    )
    .bind(message.input.message_id)
    .execute(&mut *connection)
    .await?;
    changes::append(
        connection,
        ChangeGroup {
            participants: &message.conversation.participants(),
            conversation_id: message.conversation.id,
            message_id: Some(message.input.message_id),
        },
    )
    .await?;

    Ok(())
}

/// Return the stored message and the caller's current directory projection.
pub(crate) async fn receipt(
    connection: &mut PgConnection,
    user_id: Uuid,
    message_id: Uuid,
) -> Result<SendReceipt, AccountError> {
    let mut statement = sqlx::QueryBuilder::new(MESSAGE_SELECT);
    statement.push(" WHERE message.id = ").push_bind(message_id);
    let mut message = statement
        .build_query_as::<CanonicalMessage>()
        .fetch_optional(&mut *connection)
        .await?
        .ok_or(AccountError::NotFound)?;
    let mut visible = sqlx::QueryBuilder::new(
        "SELECT EXISTS (SELECT 1 FROM messages message WHERE message.id = ",
    );
    visible.push_bind(message_id);
    super::projection::restrict_visible(&mut visible, user_id);
    visible.push(")");
    let is_visible: bool = visible.build_query_scalar().fetch_one(&mut *connection).await?;
    if !is_visible {
        message.is_deleted = true;
        message.content = super::content::MessageContent {
            schema_version: 1,
            text: String::new(),
            rich_text: None,
            custom_emoji: Vec::new(),
        };
    }
    super::projection::personalize(connection, user_id, &mut message).await?;
    let conversation = conversations::view(connection, user_id, message.conversation_id).await?;

    Ok(SendReceipt {
        message,
        conversation,
    })
}
