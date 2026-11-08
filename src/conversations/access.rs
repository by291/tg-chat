use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

use crate::{
    accounts::{AccountError, Actor},
    messages::{Destination, service::AcceptanceError},
};

use super::DIRECTORY_LIMIT;

#[derive(FromRow)]
pub(crate) struct LockedConversation {
    pub id: Uuid,
    pub kind: String,
    pub participant_low: Uuid,
    pub participant_high: Uuid,
}

impl LockedConversation {
    /// Return each participant once in the global account-lock order.
    pub(crate) fn participants(&self) -> Vec<Uuid> {
        if self.participant_low == self.participant_high {
            return vec![self.participant_low];
        }

        vec![self.participant_low, self.participant_high]
    }
}

/// Resolve and lock exactly one canonical conversation before locking participant accounts.
pub(crate) async fn lock_conversation(
    connection: &mut PgConnection,
    actor: &Actor,
    destination: &Destination,
) -> Result<LockedConversation, AcceptanceError> {
    let conversation_id = match destination {
        Destination::Conversation {
            conversation_id,
        } => *conversation_id,
        Destination::Saved => create_canonical(connection, actor.user_id, actor.user_id).await?,
        Destination::Recipient {
            user_id,
        } => {
            if *user_id == actor.user_id {
                return Err(AccountError::Validation("use Saved for personal messages").into());
            }
            create_canonical(connection, actor.user_id, *user_id).await?
        }
    };
    let query = sqlx::query_as::<_, LockedConversation>(
        "SELECT * FROM conversations WHERE id = $1
         AND ($2 = participant_low OR $2 = participant_high) FOR UPDATE",
    )
    .bind(conversation_id)
    .bind(actor.user_id);

    query.fetch_optional(connection).await?.ok_or(AccountError::NotFound.into())
}

async fn create_canonical(
    connection: &mut PgConnection,
    sender: Uuid,
    recipient: Uuid,
) -> Result<Uuid, sqlx::Error> {
    let kind = if sender == recipient {
        "saved"
    } else {
        "direct"
    };
    let insert = sqlx::query_scalar(
        "INSERT INTO conversations (id, kind, participant_low, participant_high)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (kind, participant_low, participant_high)
         DO UPDATE SET kind = EXCLUDED.kind RETURNING id",
    )
    .bind(Uuid::new_v4())
    .bind(kind);
    let insert = insert.bind(sender.min(recipient)).bind(sender.max(recipient));

    insert.fetch_one(connection).await
}

/// Serialize participant policy and capacity with contact, privacy, and suspension changes.
pub(crate) async fn lock_participants(
    connection: &mut PgConnection,
    conversation: &LockedConversation,
) -> Result<(), AcceptanceError> {
    let participants = conversation.participants();
    let locked: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM users WHERE id = ANY($1) ORDER BY id FOR UPDATE")
            .bind(&participants)
            .fetch_all(connection)
            .await?;
    if locked.len() != participants.len() {
        return Err(AccountError::ConversationUnavailable.into());
    }

    Ok(())
}

/// Check recipient-owned policy before admitting new messages, including existing chats.
pub(crate) async fn authorize_send(
    connection: &mut PgConnection,
    actor: &Actor,
    conversation: &LockedConversation,
) -> Result<(), AcceptanceError> {
    if conversation.kind == "saved" {
        return Ok(());
    }

    let recipient = if actor.user_id == conversation.participant_low {
        conversation.participant_high
    } else {
        conversation.participant_low
    };
    let query = sqlx::query_scalar::<_, bool>(
        "SELECT NOT is_suspended
         AND (direct_message_audience = 'everyone'
              OR (direct_message_audience = 'contacts' AND EXISTS (
                  SELECT 1 FROM contacts WHERE owner_id = $1 AND target_id = $2)))
         AND NOT EXISTS (SELECT 1 FROM blocks
             WHERE (owner_id = $1 AND target_id = $2) OR (owner_id = $2 AND target_id = $1))
         FROM users WHERE id = $1",
    )
    .bind(recipient)
    .bind(actor.user_id);
    if !query.fetch_one(connection).await? {
        return Err(AccountError::ConversationUnavailable.into());
    }

    Ok(())
}

/// Admit both directory memberships while their account rows serialize capacity decisions.
pub(crate) async fn admit_members(
    connection: &mut PgConnection,
    conversation: &LockedConversation,
) -> Result<(), AcceptanceError> {
    for user_id in conversation.participants() {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM conversation_members
             WHERE conversation_id = $1 AND user_id = $2 AND directory_active)",
        )
        .bind(conversation.id)
        .bind(user_id)
        .fetch_one(&mut *connection)
        .await?;
        if exists {
            continue;
        }

        if conversation.kind != "saved" {
            check_capacity(connection, user_id).await?;
        }
        sqlx::query("INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)")
            .bind(conversation.id)
            .bind(user_id)
            .execute(&mut *connection)
            .await?;
    }

    Ok(())
}

async fn check_capacity(
    connection: &mut PgConnection,
    user_id: Uuid,
) -> Result<(), AcceptanceError> {
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM conversation_members member
         JOIN conversations conversation ON conversation.id = member.conversation_id
         WHERE member.user_id = $1 AND member.directory_active AND conversation.kind != 'saved'",
    )
    .bind(user_id)
    .fetch_one(connection)
    .await?;
    if count >= DIRECTORY_LIMIT {
        return Err(AccountError::ConversationUnavailable.into());
    }

    Ok(())
}
