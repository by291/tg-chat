use sqlx::PgConnection;
use uuid::Uuid;

use super::{
    access,
    community_model::{CommunityAction, CommunityContext, CommunityRecord},
};
use crate::{accounts::AccountError, messages::service::AcceptanceError};

const GROUP_LIMIT: i64 = 200;
const CHANNEL_LIMIT: i64 = 500;

/// Resolve an active, unbanned member's role without exposing a former member as authorized.
pub(crate) async fn role(
    connection: &mut PgConnection,
    conversation_id: Uuid,
    user_id: Uuid,
) -> Result<String, AcceptanceError> {
    let query = sqlx::query_scalar(
        "SELECT member.role FROM conversation_members member
         JOIN users account ON account.id = member.user_id
         WHERE member.conversation_id = $1 AND member.user_id = $2
           AND member.directory_active AND NOT member.is_banned AND account.deleted_at IS NULL",
    )
    .bind(conversation_id)
    .bind(user_id);
    query.fetch_optional(connection).await?.ok_or(AccountError::NotFound.into())
}

/// Require an active owner or administrator after the conversation lock has serialized role changes.
pub(crate) async fn require_manager(
    connection: &mut PgConnection,
    context: &CommunityContext<'_>,
) -> Result<String, AcceptanceError> {
    let role = role(connection, context.community.id, context.actor.user_id).await?;
    if !matches!(role.as_str(), "owner" | "admin") {
        return Err(AccountError::NotFound.into());
    }
    Ok(role)
}

/// Admit exactly one account after checking its ban, suspension, and both capacity budgets.
pub(crate) async fn admit(
    connection: &mut PgConnection,
    community: &CommunityRecord,
    user_id: Uuid,
) -> Result<(), AcceptanceError> {
    let prohibited: bool = sqlx::query_scalar(
        "SELECT is_suspended OR EXISTS (SELECT 1 FROM conversation_members
             WHERE conversation_id = $1 AND user_id = $2 AND is_banned)
         FROM users WHERE id = $2",
    )
    .bind(community.id)
    .bind(user_id)
    .fetch_optional(&mut *connection)
    .await?
    .unwrap_or(true);
    if prohibited {
        return Err(AccountError::ConversationUnavailable.into());
    }
    match role(connection, community.id, user_id).await {
        Ok(_) => return Ok(()),
        Err(AcceptanceError::Business(AccountError::NotFound)) => {}
        Err(error) => return Err(error),
    }
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM conversation_members member
         JOIN users account ON account.id = member.user_id
         WHERE member.conversation_id = $1 AND member.directory_active
           AND NOT member.is_banned AND account.deleted_at IS NULL",
    )
    .bind(community.id)
    .fetch_one(&mut *connection)
    .await?;
    let limit = if community.kind == "group" {
        GROUP_LIMIT
    } else {
        CHANNEL_LIMIT
    };
    if count >= limit {
        return Err(AccountError::QuotaExceeded.into());
    }
    access::check_capacity(connection, user_id).await?;
    let insert = sqlx::query(
        "INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)
         ON CONFLICT (conversation_id, user_id) DO UPDATE SET directory_active = true,
             role = 'member', generation = conversation_members.generation + 1, is_hidden = false",
    )
    .bind(community.id)
    .bind(user_id);
    insert.execute(connection).await?;
    Ok(())
}

async fn require_manage_target(
    connection: &mut PgConnection,
    context: &CommunityContext<'_>,
    target: Uuid,
) -> Result<(), AcceptanceError> {
    let manager = require_manager(connection, context).await?;
    if target == context.community.owner_id || target == context.actor.user_id {
        return Err(AccountError::Validation(
            "the owner and your own membership cannot be moderated",
        )
        .into());
    }
    let target_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(context.community.id)
    .bind(target)
    .fetch_optional(connection)
    .await?;
    if manager != "owner" && target_role.as_deref() == Some("admin") {
        return Err(AccountError::NotFound.into());
    }
    Ok(())
}

async fn remove_member(
    connection: &mut PgConnection,
    context: &CommunityContext<'_>,
    target: Uuid,
) -> Result<(), AcceptanceError> {
    let is_banned = matches!(context.command.action, CommunityAction::Ban { .. });
    let update = sqlx::query(
        "INSERT INTO conversation_members (conversation_id, user_id, directory_active, is_banned)
         VALUES ($1, $2, false, $3)
         ON CONFLICT (conversation_id, user_id) DO UPDATE SET directory_active = false,
             is_banned = conversation_members.is_banned OR EXCLUDED.is_banned,
             role = 'member', generation = conversation_members.generation + 1",
    )
    .bind(context.community.id)
    .bind(target)
    .bind(is_banned);
    update.execute(connection).await?;
    Ok(())
}

async fn transfer(
    connection: &mut PgConnection,
    context: &CommunityContext<'_>,
    target: Uuid,
) -> Result<(), AcceptanceError> {
    if context.actor.user_id != context.community.owner_id {
        return Err(AccountError::NotFound.into());
    }
    role(connection, context.community.id, target).await?;
    let update = sqlx::query("UPDATE conversations SET owner_id = $2 WHERE id = $1")
        .bind(context.community.id)
        .bind(target);
    update.execute(&mut *connection).await?;
    let is_channel = context.community.kind == "channel";
    // A subscriber gaining ownership must refresh history to receive moderator attribution.
    let roles = sqlx::query(
        "UPDATE conversation_members
         SET role = CASE WHEN user_id = $2 THEN 'owner' ELSE 'admin' END,
             generation = generation
                 + CASE WHEN $3 AND user_id = $2 AND role = 'member' THEN 1 ELSE 0 END
         WHERE conversation_id = $1 AND (role = 'owner' OR user_id = $2)",
    )
    .bind(context.community.id)
    .bind(target)
    .bind(is_channel);
    roles.execute(connection).await?;
    Ok(())
}

async fn moderate(
    connection: &mut PgConnection,
    context: &CommunityContext<'_>,
    target: Uuid,
) -> Result<(), AcceptanceError> {
    require_manage_target(connection, context, target).await?;
    match &context.command.action {
        CommunityAction::Remove {
            ..
        }
        | CommunityAction::Ban {
            ..
        } => {
            remove_member(connection, context, target).await?;
        }
        CommunityAction::Unban {
            ..
        } => {
            let update = sqlx::query(
                "UPDATE conversation_members SET is_banned = false
                 WHERE conversation_id = $1 AND user_id = $2",
            )
            .bind(context.community.id)
            .bind(target);
            update.execute(connection).await?;
        }
        CommunityAction::Mute {
            until,
            ..
        } => {
            let update = sqlx::query(
                "UPDATE conversation_members SET posting_muted_until = $3
                 WHERE conversation_id = $1 AND user_id = $2 AND directory_active",
            )
            .bind(context.community.id)
            .bind(target)
            .bind(until);
            update.execute(connection).await?;
        }
        CommunityAction::Role {
            role: desired,
            ..
        } => {
            if context.actor.user_id != context.community.owner_id
                || !matches!(desired.as_str(), "admin" | "member")
            {
                return Err(AccountError::NotFound.into());
            }
            role(connection, context.community.id, target).await?;
            let is_channel = context.community.kind == "channel";
            // Fence cached history and in-flight pages when checklist attribution access changes.
            let update = sqlx::query(
                "UPDATE conversation_members SET role = $3,
                     generation = generation + CASE WHEN $4 AND role <> $3 THEN 1 ELSE 0 END
                 WHERE conversation_id = $1 AND user_id = $2",
            )
            .bind(context.community.id)
            .bind(target)
            .bind(desired);
            let update = update.bind(is_channel);
            update.execute(connection).await?;
        }
        _ => return Err(AccountError::Validation("expected a moderation action").into()),
    }
    Ok(())
}

/// Apply role and membership changes without bypassing the aggregate's publication lock.
pub(crate) async fn apply(
    connection: &mut PgConnection,
    context: &CommunityContext<'_>,
) -> Result<(), AcceptanceError> {
    match &context.command.action {
        CommunityAction::Leave => {
            role(connection, context.community.id, context.actor.user_id).await?;
            if context.actor.user_id == context.community.owner_id {
                return Err(AccountError::Validation(
                    "transfer ownership or delete before leaving",
                )
                .into());
            }
            remove_member(connection, context, context.actor.user_id).await?;
        }
        CommunityAction::Transfer {
            user_id,
        } => transfer(connection, context, *user_id).await?,
        CommunityAction::Delete => {
            if context.actor.user_id != context.community.owner_id {
                return Err(AccountError::NotFound.into());
            }
            let delete = sqlx::query("UPDATE conversations SET deleted_at = now() WHERE id = $1")
                .bind(context.community.id);
            delete.execute(&mut *connection).await?;
            let revoke = sqlx::query(
                "UPDATE conversation_members SET directory_active = false, generation = generation + 1
                 WHERE conversation_id = $1 AND directory_active",
            )
            .bind(context.community.id);
            revoke.execute(connection).await?;
        }
        _ => {
            let target = context.command.action.target_user().ok_or(AccountError::NotFound)?;
            moderate(connection, context, target).await?;
        }
    }
    Ok(())
}
