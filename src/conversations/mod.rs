//! Authorized conversation membership and personal directory projections.

pub(crate) mod access;
mod community_model;
mod community_queries;
mod community_service;
pub(crate) mod http;
mod invitations;
mod membership;
pub use community_queries::{
    CommunityListQuery, CommunityMember, CommunityMemberPage, CommunityPage, CommunityPageQuery,
    CommunitySummary, InvitationPage, InvitationQuery, InvitationView, InvitePreview,
    JoinRequestPage, JoinRequestView,
};

pub use community_model::{CommunityAction, CommunityCommand, CommunitySettings, CreateCommunity};

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
    "SELECT conversation.id, conversation.kind, COALESCE(peer.id, conversation.id) AS peer_id,
            COALESCE(peer.username, conversation.public_handle, '') AS peer_username,
            COALESCE(peer.display_name, conversation.title) AS peer_name,
            conversation.avatar_file_id,
            CASE WHEN NOT peer.is_suspended THEN peer.avatar_file_id END AS peer_avatar_file_id,
            conversation.title, conversation.description, conversation.public_handle,
            conversation.is_public, conversation.requires_approval, member.role, member.posting_muted_until,
            conversation.settings_version::text,
            (conversation.kind = 'saved'
             OR (conversation.kind = 'direct' AND peer.deleted_at IS NULL)
             OR (conversation.kind IN ('group', 'channel') AND
                (member.posting_muted_until IS NULL OR member.posting_muted_until <= now())
                AND (conversation.kind = 'group' OR member.role IN ('owner', 'admin')))) AS can_post,
            (conversation.kind IN ('direct', 'saved') OR member.role IN ('owner', 'admin')) AS can_manage,
            conversation.forwarding_enabled AS is_forwarding_enabled,
            (conversation.kind IN ('direct', 'saved') OR member.role = 'owner')
                AS can_set_forwarding_policy,
            (conversation.kind = 'direct' AND CASE
                WHEN member.user_id = conversation.participant_low THEN conversation.forwarding_low_consent
                ELSE conversation.forwarding_high_consent END) AS has_forwarding_consent,
            conversation.last_sequence::text, conversation.version::text,
            COALESCE(summary.text, '') AS summary_text, summary.expires_at AS summary_expires_at,
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
     LEFT JOIN users peer ON peer.id = CASE WHEN conversation.participant_low = member.user_id
         THEN conversation.participant_high ELSE conversation.participant_low END
     LEFT JOIN LATERAL (
         SELECT CASE WHEN message.body IS NOT NULL THEN COALESCE(
                          message_body_preview(message.body),
                          initcap(replace(message.body->>'kind', '_', ' ')))
                     WHEN btrim(message.content->>'text') <> '' THEN message.content->>'text'
                     WHEN EXISTS (SELECT 1 FROM media_message_references reference
                                  WHERE reference.message_id = message.id) THEN 'Media message'
                     ELSE '' END AS text,
                message.expires_at FROM messages message
         WHERE message.conversation_id = conversation.id
           AND message.sequence > member.clear_through AND message.deleted_at IS NULL
           AND (message.expires_at IS NULL OR message.expires_at > now())
           AND NOT EXISTS (SELECT 1 FROM hidden_messages hidden
               WHERE hidden.user_id = member.user_id AND hidden.message_id = message.id)
         ORDER BY message.sequence DESC LIMIT 1
     ) summary ON true";

#[derive(Clone, FromRow, Serialize, ToSchema)]
pub struct ConversationView {
    pub id: Uuid,
    pub kind: String,
    pub peer_id: Uuid,
    pub peer_username: String,
    pub peer_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peer_avatar_file_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_file_id: Option<Uuid>,
    pub settings_version: String,
    pub title: String,
    pub description: String,
    pub public_handle: Option<String>,
    pub is_public: bool,
    pub requires_approval: bool,
    pub role: String,
    pub can_post: bool,
    pub posting_muted_until: Option<DateTime<Utc>>,
    pub can_manage: bool,
    pub is_forwarding_enabled: bool,
    pub can_set_forwarding_policy: bool,
    pub has_forwarding_consent: bool,
    pub last_sequence: String,
    pub version: String,
    pub summary_text: String,
    pub summary_expires_at: Option<DateTime<Utc>>,
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
    statement.push(
        " AND member.directory_active AND NOT member.is_banned
        AND conversation.deleted_at IS NULL AND NOT conversation.is_quarantined",
    );
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
    pub reply_expires_at: Option<DateTime<Utc>>,
    pub is_reply_unavailable: Option<bool>,
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
    let source = crate::messages::projection::reply_source(
        connection,
        crate::messages::projection::ReplySourceQuery {
            user_id,
            conversation_id: conversation.id,
            message_id: reply.message_id,
        },
    )
    .await?;
    conversation.draft.is_reply_unavailable = Some(source.is_none());
    conversation.draft.reply_expires_at = source.as_ref().and_then(|source| source.expires_at);
    let is_valid_quote = source.as_ref().is_some_and(|source| {
        reply.quote.as_ref().is_some_and(|quote| source.text.contains(quote))
    });
    if !is_valid_quote {
        reply.quote = None;
    }

    Ok(())
}
