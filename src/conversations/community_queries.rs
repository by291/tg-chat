use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection, QueryBuilder};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use super::{ConversationView, invitations};
use crate::{
    accounts::{AccountError, Actor},
    messages::MessageService,
};

const DEFAULT_PAGE_SIZE: u16 = 50;
const MAX_PAGE_SIZE: u16 = 100;
const MAX_SEARCH_CHARACTERS: usize = 100;
const SUMMARY_SELECT: &str =
    "SELECT conversation.id, conversation.kind, conversation.title, conversation.description,
        conversation.public_handle, conversation.is_public, conversation.requires_approval,
        conversation.avatar_file_id,
        (SELECT count(*)::text FROM conversation_members member
         JOIN users account ON account.id = member.user_id
         WHERE member.conversation_id = conversation.id AND member.directory_active
           AND NOT member.is_banned AND account.deleted_at IS NULL) AS member_count
     FROM conversations conversation";

#[derive(Clone, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct CommunityListQuery {
    pub after: Option<Uuid>,
    pub limit: Option<u16>,
    pub search: Option<String>,
}

pub struct CommunityPageQuery {
    pub conversation_id: Uuid,
    pub page: CommunityListQuery,
}

impl CommunityPageQuery {
    /// Start a bounded community-owned listing at its first page.
    pub fn new(conversation_id: Uuid) -> Self {
        Self {
            conversation_id,
            page: CommunityListQuery::default(),
        }
    }
}

#[derive(FromRow, Serialize, ToSchema)]
pub struct CommunitySummary {
    pub id: Uuid,
    pub kind: String,
    pub title: String,
    pub description: String,
    pub public_handle: Option<String>,
    pub is_public: bool,
    pub requires_approval: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_file_id: Option<Uuid>,
    pub member_count: String,
}

#[derive(FromRow, Serialize, ToSchema)]
pub struct InvitePreview {
    pub id: Uuid,
    pub kind: String,
    pub title: String,
    pub requires_approval: bool,
}

#[derive(Serialize, ToSchema)]
pub struct CommunityPage {
    pub items: Vec<CommunitySummary>,
    pub next: Option<Uuid>,
}

#[derive(FromRow, Serialize, ToSchema)]
pub struct CommunityMember {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub is_banned: bool,
    pub is_active: bool,
    pub posting_muted_until: Option<DateTime<Utc>>,
}

#[derive(Serialize, ToSchema)]
pub struct CommunityMemberPage {
    pub items: Vec<CommunityMember>,
    pub next: Option<Uuid>,
}

#[derive(FromRow, Serialize, ToSchema)]
pub struct JoinRequestView {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, ToSchema)]
pub struct JoinRequestPage {
    pub items: Vec<JoinRequestView>,
    pub next: Option<Uuid>,
}

#[derive(FromRow, Serialize, ToSchema)]
pub struct InvitationView {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub title: String,
    pub target_id: Option<Uuid>,
    pub expires_at: DateTime<Utc>,
    pub max_uses: Option<i64>,
    pub uses: i64,
    pub revoked_at: Option<DateTime<Utc>>,
}

#[derive(Serialize, ToSchema)]
pub struct InvitationPage {
    pub items: Vec<InvitationView>,
    pub next: Option<Uuid>,
}

pub struct InvitationQuery {
    pub conversation_id: Option<Uuid>,
    pub page: CommunityListQuery,
}

fn page_size(query: &CommunityListQuery) -> Result<usize, AccountError> {
    let size = query.limit.unwrap_or(DEFAULT_PAGE_SIZE);
    if !(1..=MAX_PAGE_SIZE).contains(&size) {
        return Err(AccountError::Validation("page size must be between 1 and 100"));
    }
    Ok(usize::from(size))
}

fn trim_page<T>(items: &mut Vec<T>, limit: usize, identity: impl Fn(&T) -> Uuid) -> Option<Uuid> {
    if items.len() <= limit {
        return None;
    }
    items.truncate(limit);
    items.last().map(identity)
}

fn require_manager(conversation: &ConversationView) -> Result<(), AccountError> {
    if !matches!(conversation.role.as_str(), "owner" | "admin") {
        return Err(AccountError::NotFound);
    }
    Ok(())
}

async fn community_view(
    connection: &mut PgConnection,
    actor: &Actor,
    id: Uuid,
) -> Result<ConversationView, AccountError> {
    let conversation = super::view(connection, actor.user_id, id).await?;
    if !matches!(conversation.kind.as_str(), "group" | "channel") {
        return Err(AccountError::NotFound);
    }
    Ok(conversation)
}

impl MessageService {
    /// Discover only public metadata currently available to the authenticated account.
    pub async fn discover_communities(
        &self,
        actor: Actor,
        query: CommunityListQuery,
    ) -> Result<CommunityPage, AccountError> {
        let limit = page_size(&query)?;
        let search = query.search.unwrap_or_default().trim().to_owned();
        if search.chars().count() > MAX_SEARCH_CHARACTERS {
            return Err(AccountError::Validation("community search exceeds 100 characters"));
        }
        let mut transaction = self.snapshot(&actor).await?;
        let mut statement = QueryBuilder::new(SUMMARY_SELECT);
        statement.push(" WHERE conversation.is_public AND conversation.deleted_at IS NULL\n            AND NOT conversation.is_quarantined AND conversation.kind IN ('group', 'channel')\n            AND NOT EXISTS (SELECT 1 FROM conversation_members banned WHERE banned.conversation_id = conversation.id\n                AND banned.is_banned AND banned.user_id = ").push_bind(actor.user_id);
        statement.push(") AND (").push_bind(query.after);
        statement.push("::uuid IS NULL OR conversation.id > ").push_bind(query.after).push(")");
        statement.push(" AND strpos(lower(conversation.title || ' ' || conversation.public_handle), lower(")
            .push_bind(search).push(")) > 0 ORDER BY conversation.id LIMIT ");
        statement.push_bind((limit + 1) as i64);
        let mut items: Vec<CommunitySummary> =
            statement.build_query_as().fetch_all(&mut *transaction).await?;
        let next = trim_page(&mut items, limit, |item| item.id);
        transaction.commit().await?;
        Ok(CommunityPage {
            items,
            next,
        })
    }

    /// Return private community details only while the requesting account remains admitted.
    pub async fn community_details(
        &self,
        actor: Actor,
        id: Uuid,
    ) -> Result<ConversationView, AccountError> {
        let mut transaction = self.snapshot(&actor).await?;
        let conversation = community_view(&mut transaction, &actor, id).await?;
        transaction.commit().await?;
        Ok(conversation)
    }

    /// Reveal only the minimal identity associated with a currently usable bearer invitation.
    pub async fn invite_preview(
        &self,
        actor: Actor,
        token: String,
    ) -> Result<InvitePreview, AccountError> {
        let mut transaction = self.snapshot(&actor).await?;
        let mut statement = QueryBuilder::new(
            "SELECT conversation.id, conversation.kind, conversation.title, conversation.requires_approval
             FROM conversations conversation",
        );
        statement.push(
            " JOIN community_invitations invitation ON invitation.conversation_id = conversation.id
              JOIN users creator ON creator.id = invitation.created_by
              WHERE conversation.deleted_at IS NULL AND NOT conversation.is_quarantined
                AND creator.deleted_at IS NULL AND invitation.revoked_at IS NULL
                AND invitation.expires_at > now()
                AND (invitation.max_uses IS NULL OR invitation.uses < invitation.max_uses)
                AND invitation.token_hash = ",
        );
        statement.push_bind(invitations::token_hash(&token)?);
        statement.push(
            " AND NOT EXISTS (
                SELECT 1 FROM conversation_members banned WHERE banned.conversation_id = conversation.id
                  AND banned.is_banned AND banned.user_id = ",
        );
        statement.push_bind(actor.user_id).push(")");
        let summary = statement
            .build_query_as()
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or(AccountError::NotFound)?;
        transaction.commit().await?;
        Ok(summary)
    }

    /// Page authorized members; ordinary channel subscribers can see only themselves.
    pub async fn community_members(
        &self,
        actor: Actor,
        query: CommunityPageQuery,
    ) -> Result<CommunityMemberPage, AccountError> {
        let limit = page_size(&query.page)?;
        let mut transaction = self.snapshot(&actor).await?;
        let conversation = community_view(&mut transaction, &actor, query.conversation_id).await?;
        let can_manage = matches!(conversation.role.as_str(), "owner" | "admin");
        let is_self_only = conversation.kind == "channel" && !can_manage;
        let members = sqlx::query_as(
            "SELECT account.id, account.username, account.display_name, member.role, member.is_banned,
                member.directory_active AS is_active, member.posting_muted_until
             FROM conversation_members member JOIN users account ON account.id = member.user_id
             WHERE member.conversation_id = $1 AND account.deleted_at IS NULL
               AND (member.directory_active OR ($2 AND member.is_banned))
               AND (NOT $3 OR member.user_id = $4) AND ($5::uuid IS NULL OR member.user_id > $5)
             ORDER BY member.user_id LIMIT $6",
        )
        .bind(query.conversation_id).bind(can_manage).bind(is_self_only);
        let members = members.bind(actor.user_id).bind(query.page.after).bind((limit + 1) as i64);
        let mut items: Vec<CommunityMember> = members.fetch_all(&mut *transaction).await?;
        let next = trim_page(&mut items, limit, |item| item.id);
        transaction.commit().await?;
        Ok(CommunityMemberPage {
            items,
            next,
        })
    }

    /// Page pending requests for current administrators without exposing them to ordinary members.
    pub async fn community_requests(
        &self,
        actor: Actor,
        query: CommunityPageQuery,
    ) -> Result<JoinRequestPage, AccountError> {
        let limit = page_size(&query.page)?;
        let mut transaction = self.snapshot(&actor).await?;
        let conversation = community_view(&mut transaction, &actor, query.conversation_id).await?;
        require_manager(&conversation)?;
        let requests = sqlx::query_as(
            "SELECT account.id, account.username, account.display_name, request.created_at
             FROM community_join_requests request JOIN users account ON account.id = request.user_id
             WHERE request.conversation_id = $1 AND account.deleted_at IS NULL
               AND ($2::uuid IS NULL OR request.user_id > $2)
             ORDER BY request.user_id LIMIT $3",
        )
        .bind(query.conversation_id)
        .bind(query.page.after)
        .bind((limit + 1) as i64);
        let mut items: Vec<JoinRequestView> = requests.fetch_all(&mut *transaction).await?;
        let next = trim_page(&mut items, limit, |item| item.id);
        transaction.commit().await?;
        Ok(JoinRequestPage {
            items,
            next,
        })
    }

    /// Page a recipient's pending direct invitations or an administrator's community invitations.
    pub async fn community_invitations(
        &self,
        actor: Actor,
        query: InvitationQuery,
    ) -> Result<InvitationPage, AccountError> {
        let limit = page_size(&query.page)?;
        let mut transaction = self.snapshot(&actor).await?;
        if let Some(id) = query.conversation_id {
            let conversation = community_view(&mut transaction, &actor, id).await?;
            require_manager(&conversation)?;
        }
        let invitations = sqlx::query_as(
            "SELECT invitation.id, invitation.conversation_id, conversation.title, invitation.target_id,
                invitation.expires_at, invitation.max_uses, invitation.uses, invitation.revoked_at
             FROM community_invitations invitation
             JOIN conversations conversation ON conversation.id = invitation.conversation_id
             JOIN users creator ON creator.id = invitation.created_by
             LEFT JOIN users target ON target.id = invitation.target_id
             WHERE conversation.deleted_at IS NULL AND NOT conversation.is_quarantined
               AND creator.deleted_at IS NULL AND target.deleted_at IS NULL
               AND (($1::uuid IS NOT NULL AND conversation.id = $1)
                 OR ($1 IS NULL AND invitation.target_id = $2 AND invitation.revoked_at IS NULL
                    AND invitation.expires_at > now() AND invitation.uses = 0))
               AND ($3::uuid IS NULL OR invitation.id > $3)
             ORDER BY invitation.id LIMIT $4",
        )
        .bind(query.conversation_id).bind(actor.user_id).bind(query.page.after);
        let mut items: Vec<InvitationView> =
            invitations.bind((limit + 1) as i64).fetch_all(&mut *transaction).await?;
        let next = trim_page(&mut items, limit, |item| item.id);
        transaction.commit().await?;
        Ok(InvitationPage {
            items,
            next,
        })
    }
}
