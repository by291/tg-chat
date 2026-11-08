//! Canonical direct/Saved membership and personal directory projections.

pub(crate) mod access;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    accounts::AccountError,
    messages::{ReplyInput, content::MessageContent},
};

pub(crate) mod state;

pub(crate) const DIRECTORY_LIMIT: i64 = 200;
pub(crate) const VIEW_SELECT: &str =
    "SELECT conversation.id, conversation.kind, peer.id AS peer_id,
            peer.username AS peer_username, peer.display_name AS peer_name,
            conversation.last_sequence::text, conversation.version::text,
            COALESCE((SELECT message.content->>'text' FROM messages message
                WHERE message.conversation_id = conversation.id
                  AND message.sequence > member.clear_through AND message.deleted_at IS NULL
                  AND (message.expires_at IS NULL OR message.expires_at > now())
                  AND NOT EXISTS (SELECT 1 FROM hidden_messages hidden
                      WHERE hidden.user_id = member.user_id AND hidden.message_id = message.id)
                ORDER BY message.sequence DESC LIMIT 1), '') AS summary_text,
            conversation.updated_at,
            member.generation::text,
            (SELECT count(*)::text FROM messages message
                WHERE message.conversation_id = conversation.id AND message.service_kind IS NULL
                  AND message.sequence > greatest(member.read_through, member.clear_through)
                  AND message.author_id <> member.user_id AND message.deleted_at IS NULL
                  AND (message.expires_at IS NULL OR message.expires_at > now())
                  AND NOT EXISTS (SELECT 1 FROM hidden_messages hidden
                      WHERE hidden.user_id = member.user_id AND hidden.message_id = message.id)
            ) AS unread_count,
            member.read_through::text, member.clear_through::text,
            member.is_archived, member.is_hidden, member.is_manually_unread,
            member.pin_rank, member.muted_until, member.keep_archived, conversation.expiry_days,
            COALESCE((SELECT peer_member.read_through::text FROM conversation_members peer_member
                WHERE peer_member.conversation_id = conversation.id
                  AND peer_member.user_id = peer.id), '0') AS peer_read_through,
            jsonb_build_object('version', member.draft_version::text,
                'content', member.draft_content, 'reply', member.draft_reply) AS draft
     FROM conversations conversation
     JOIN conversation_members member ON member.conversation_id = conversation.id
     JOIN users peer ON peer.id = CASE WHEN conversation.participant_low = member.user_id
         THEN conversation.participant_high ELSE conversation.participant_low END";

#[derive(Clone, FromRow, Serialize, ToSchema)]
pub struct ConversationView {
    pub id: Uuid,
    pub kind: String,
    pub peer_id: Uuid,
    pub peer_username: String,
    pub peer_name: String,
    pub last_sequence: String,
    pub version: String,
    pub summary_text: String,
    pub updated_at: DateTime<Utc>,
    pub generation: String,
    pub unread_count: String,
    pub read_through: String,
    pub clear_through: String,
    pub is_archived: bool,
    pub is_hidden: bool,
    pub is_manually_unread: bool,
    pub pin_rank: Option<i32>,
    pub muted_until: Option<DateTime<Utc>>,
    pub keep_archived: bool,
    pub expiry_days: i32,
    pub peer_read_through: String,
    #[sqlx(json)]
    pub draft: DraftView,
}

/// Materialize only a directory entry owned by the requesting account.
pub(crate) async fn view(
    connection: &mut PgConnection,
    user_id: Uuid,
    conversation_id: Uuid,
) -> Result<ConversationView, AccountError> {
    let mut statement = sqlx::QueryBuilder::new(VIEW_SELECT);
    statement.push(" WHERE member.user_id = ").push_bind(user_id);
    statement.push(" AND conversation.id = ").push_bind(conversation_id);
    statement.push(" AND member.directory_active");
    let query = statement.build_query_as();

    let mut conversation =
        query.fetch_optional(&mut *connection).await?.ok_or(AccountError::NotFound)?;
    scrub_draft_reply(connection, user_id, &mut conversation).await?;

    Ok(conversation)
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
pub struct DraftView {
    pub version: String,
    pub content: Option<MessageContent>,
    pub reply: Option<ReplyInput>,
}

/// Remove draft quote excerpts when their source is no longer visible in this snapshot.
pub(crate) async fn scrub_draft_reply(
    connection: &mut PgConnection,
    user_id: Uuid,
    conversation: &mut ConversationView,
) -> Result<(), AccountError> {
    let Some(reply) = &mut conversation.draft.reply else {
        return Ok(());
    };
    let mut statement = sqlx::QueryBuilder::new(
        "SELECT message.content->>'text' FROM messages message WHERE message.id = ",
    );
    statement.push_bind(reply.message_id);
    statement.push(" AND message.conversation_id = ").push_bind(conversation.id);
    crate::messages::projection::restrict_visible(&mut statement, user_id);
    let source: Option<String> = statement.build_query_scalar().fetch_optional(connection).await?;
    let is_valid_quote = source
        .as_ref()
        .is_some_and(|text| reply.quote.as_ref().is_some_and(|quote| text.contains(quote)));
    if !is_valid_quote {
        reply.quote = None;
    }

    Ok(())
}
