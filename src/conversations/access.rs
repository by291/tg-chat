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
    pub participant_low: Option<Uuid>,
    pub participant_high: Option<Uuid>,
}

impl LockedConversation {
    /// Distinguish membership-governed conversations from fixed participant pairs.
    pub(crate) fn is_community(&self) -> bool {
        matches!(self.kind.as_str(), "group" | "channel")
    }
}

/// Read the stable recipient set while the caller owns the conversation lock.
pub(crate) async fn participants(
    connection: &mut PgConnection,
    conversation: &LockedConversation,
) -> Result<Vec<Uuid>, sqlx::Error> {
    if conversation.is_community() {
        return sqlx::query_scalar(
            "SELECT user_id FROM conversation_members WHERE conversation_id = $1
             AND directory_active AND NOT is_banned ORDER BY user_id",
        )
        .bind(conversation.id)
        .fetch_all(connection)
        .await;
    }
    let mut participants: Vec<Uuid> = [conversation.participant_low, conversation.participant_high]
        .into_iter()
        .flatten()
        .collect();
    participants.sort();
    participants.dedup();
    Ok(participants)
}

/// Enforce management authority against membership protected by the conversation lock.
pub(crate) async fn require_manager(
    connection: &mut PgConnection,
    actor: &Actor,
    conversation: &LockedConversation,
) -> Result<(), AcceptanceError> {
    if !conversation.is_community() {
        return Ok(());
    }
    let permitted = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = $1
         AND user_id = $2 AND directory_active AND NOT is_banned AND role IN ('owner', 'admin'))",
    )
    .bind(conversation.id)
    .bind(actor.user_id);
    if !permitted.fetch_one(connection).await? {
        return Err(AccountError::NotFound.into());
    }
    Ok(())
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
         AND deleted_at IS NULL AND NOT is_quarantined
         AND ($2 = participant_low OR $2 = participant_high OR EXISTS (
             SELECT 1 FROM conversation_members member WHERE member.conversation_id = conversations.id
             AND member.user_id = $2 AND member.directory_active AND NOT member.is_banned))
         FOR UPDATE",
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
    let participants = participants(connection, conversation).await?;
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

    if conversation.is_community() {
        let permitted = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = $1
             AND user_id = $2 AND directory_active AND NOT is_banned
             AND (posting_muted_until IS NULL OR posting_muted_until <= now())
             AND ($3 = 'group' OR role IN ('owner', 'admin')))",
        )
        .bind(conversation.id)
        .bind(actor.user_id)
        .bind(&conversation.kind);
        if !permitted.fetch_one(connection).await? {
            return Err(AccountError::ConversationUnavailable.into());
        }
        return Ok(());
    }
    let recipient = if Some(actor.user_id) == conversation.participant_low {
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
    if conversation.is_community() {
        return Ok(());
    }
    for user_id in participants(connection, conversation).await? {
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
        sqlx::query(
            "INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)
             ON CONFLICT (conversation_id, user_id) DO UPDATE SET directory_active = true,
                 generation = conversation_members.generation + 1, is_hidden = false",
        )
        .bind(conversation.id)
        .bind(user_id)
        .execute(&mut *connection)
        .await?;
    }

    Ok(())
}

/// Check the caller-locked account directory before activating a new membership.
pub(crate) async fn check_capacity(
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
