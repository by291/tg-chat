//! Canonical direct/Saved membership and personal directory projections.

pub(crate) mod access;

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgConnection};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::accounts::AccountError;

pub(crate) const DIRECTORY_LIMIT: i64 = 200;
pub(crate) const VIEW_SELECT: &str =
    "SELECT conversation.id, conversation.kind, peer.id AS peer_id,
            peer.username AS peer_username, peer.display_name AS peer_name,
            conversation.last_sequence::text, conversation.version::text,
            conversation.summary_text, conversation.updated_at,
            member.generation::text, member.unread_count::text,
            member.read_through::text, member.clear_through::text,
            member.is_archived, member.is_hidden, member.is_manually_unread,
            member.pin_rank, member.muted_until
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

    query.fetch_optional(connection).await?.ok_or(AccountError::NotFound)
}
