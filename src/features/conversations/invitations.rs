use chrono::Utc;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

use super::{
    community_model::{CommunityAction, CommunityContext, CommunityRecord},
    membership,
};
use crate::features::{accounts::AccountError, messages::service::AcceptanceError};

const INVITE_TOKEN_LENGTH: usize = 64;
const MAX_INVITE_USES: i64 = 500;
const MAX_ACTIVE_INVITATIONS: i64 = 100;
const MAX_PENDING_REQUESTS: i64 = 1000;

#[derive(FromRow)]
struct AdmissionInvitation {
    id: Uuid,
    target_id: Option<Uuid>,
}

struct Admission<'a> {
    community: &'a CommunityRecord,
    user_id: Uuid,
    invitation_id: Option<Uuid>,
}

/// Hash a validated opaque secret without retaining recoverable invitation credentials.
pub(crate) fn token_hash(token: &str) -> Result<Vec<u8>, AccountError> {
    if token.len() != INVITE_TOKEN_LENGTH || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AccountError::NotFound);
    }
    Ok(Sha256::digest(token.as_bytes()).to_vec())
}

async fn invitation(
    connection: &mut PgConnection,
    admission: &Admission<'_>,
) -> Result<Option<AdmissionInvitation>, AcceptanceError> {
    let Some(invitation_id) = admission.invitation_id else {
        if !admission.community.is_public {
            return Err(AccountError::NotFound.into());
        }
        return Ok(None);
    };
    let query = sqlx::query_as::<_, AdmissionInvitation>(
        "SELECT invitation.id, invitation.target_id FROM community_invitations invitation
         JOIN users creator ON creator.id = invitation.created_by
         WHERE invitation.id = $1 AND invitation.conversation_id = $2
           AND (invitation.target_id IS NULL OR invitation.target_id = $3)
           AND invitation.revoked_at IS NULL AND invitation.expires_at > now()
           AND (invitation.max_uses IS NULL OR invitation.uses < invitation.max_uses)
           AND creator.deleted_at IS NULL",
    )
    .bind(invitation_id)
    .bind(admission.community.id)
    .bind(admission.user_id);
    let invitation = query.fetch_optional(connection).await?.ok_or(AccountError::NotFound)?;
    Ok(Some(invitation))
}

async fn admit(
    connection: &mut PgConnection,
    admission: &Admission<'_>,
) -> Result<(), AcceptanceError> {
    let invite = invitation(connection, admission).await?;
    membership::admit(connection, admission.community, admission.user_id).await?;
    if let Some(invite) = invite {
        // The conversation lock serializes the final use with joins and approvals.
        let consume = sqlx::query("UPDATE community_invitations SET uses = uses + 1 WHERE id = $1")
            .bind(invite.id);
        consume.execute(&mut *connection).await?;
    }
    let clear = sqlx::query(
        "DELETE FROM community_join_requests WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(admission.community.id)
    .bind(admission.user_id);
    clear.execute(connection).await?;
    Ok(())
}

async fn join(
    connection: &mut PgConnection,
    context: &CommunityContext<'_>,
) -> Result<(), AcceptanceError> {
    let CommunityAction::Join {
        token,
        invitation_id,
    } = &context.command.action
    else {
        return Err(AccountError::Validation("expected a join action").into());
    };

    match membership::role(connection, context.community.id, context.actor.user_id).await {
        Ok(_) => return Ok(()),
        Err(AcceptanceError::Business(AccountError::NotFound)) => {}
        Err(error) => return Err(error),
    }
    let is_banned: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = $1
         AND user_id = $2 AND is_banned)",
    )
    .bind(context.community.id)
    .bind(context.actor.user_id)
    .fetch_one(&mut *connection)
    .await?;
    if is_banned || (token.is_some() && invitation_id.is_some()) {
        return Err(AccountError::NotFound.into());
    }

    let invitation_id = if let Some(token) = token {
        let query = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM community_invitations WHERE conversation_id = $1 AND token_hash = $2",
        );
        let query = query.bind(context.community.id).bind(token_hash(token)?);
        let found = query.fetch_optional(&mut *connection).await?;

        Some(found.ok_or(AccountError::NotFound)?)
    } else if let Some(invitation_id) = invitation_id {
        // A link identifier is not its bearer secret; only targeted invitations accept an ID.
        let lookup = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM community_invitations WHERE id = $1
             AND conversation_id = $2 AND target_id = $3)",
        );
        let lookup = lookup.bind(invitation_id).bind(context.community.id);
        let lookup = lookup.bind(context.actor.user_id);
        let is_targeted: bool = lookup.fetch_one(&mut *connection).await?;
        if !is_targeted {
            return Err(AccountError::NotFound.into());
        }

        Some(*invitation_id)
    } else {
        None
    };

    let admission = Admission {
        community: context.community,
        user_id: context.actor.user_id,
        invitation_id,
    };
    let invitation = invitation(connection, &admission).await?;
    let is_direct_invitation = invitation.as_ref().is_some_and(|invite| invite.target_id.is_some());

    // A targeted invitation is already an explicit approval for this account.
    if !context.community.requires_approval || is_direct_invitation {
        return admit(connection, &admission).await;
    }

    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM community_join_requests request
         JOIN users account ON account.id = request.user_id
         WHERE request.conversation_id = $1 AND request.user_id <> $2
           AND account.deleted_at IS NULL",
    )
    .bind(context.community.id)
    .bind(context.actor.user_id)
    .fetch_one(&mut *connection)
    .await?;
    if count >= MAX_PENDING_REQUESTS {
        return Err(AccountError::QuotaExceeded.into());
    }

    let request = sqlx::query(
        "INSERT INTO community_join_requests (conversation_id, user_id, invitation_id)
         VALUES ($1, $2, $3) ON CONFLICT (conversation_id, user_id)
         DO UPDATE SET invitation_id = EXCLUDED.invitation_id, created_at = now()",
    )
    .bind(context.community.id)
    .bind(context.actor.user_id)
    .bind(invitation_id);
    request.execute(connection).await?;

    Ok(())
}

async fn create(
    connection: &mut PgConnection,
    context: &CommunityContext<'_>,
) -> Result<(), AcceptanceError> {
    membership::require_manager(connection, context).await?;
    let CommunityAction::Invite {
        invitation_id,
        token,
        target_id,
        expires_at,
        max_uses,
    } = &context.command.action
    else {
        return Err(AccountError::Validation("expected an invitation").into());
    };
    let has_one_destination = token.is_some() != target_id.is_some();
    let has_valid_uses = max_uses.is_none_or(|uses| (1..=MAX_INVITE_USES).contains(&uses));
    if !has_one_destination || !has_valid_uses || *expires_at <= Utc::now() {
        return Err(AccountError::Validation(
            "invitations require one destination and valid expiry/use limits",
        )
        .into());
    }
    if let Some(target_id) = target_id {
        let query = sqlx::query_scalar(
            "SELECT NOT is_suspended AND NOT EXISTS (SELECT 1 FROM blocks
                WHERE (owner_id = $1 AND target_id = $2) OR (owner_id = $2 AND target_id = $1))
             FROM users WHERE id = $1",
        )
        .bind(target_id)
        .bind(context.actor.user_id);
        let is_permitted = query.fetch_optional(&mut *connection).await?.unwrap_or(false);
        if !is_permitted {
            return Err(AccountError::ConversationUnavailable.into());
        }
    }

    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM community_invitations invitation
         JOIN users creator ON creator.id = invitation.created_by
         LEFT JOIN users target ON target.id = invitation.target_id
         WHERE invitation.conversation_id = $1 AND invitation.revoked_at IS NULL
           AND invitation.expires_at > now()
           AND (invitation.max_uses IS NULL OR invitation.uses < invitation.max_uses)
           AND creator.deleted_at IS NULL AND target.deleted_at IS NULL",
    )
    .bind(context.community.id)
    .fetch_one(&mut *connection)
    .await?;
    if count >= MAX_ACTIVE_INVITATIONS {
        return Err(AccountError::QuotaExceeded.into());
    }
    let hash = token.as_deref().map(token_hash).transpose()?;
    let limit = if target_id.is_some() {
        Some(1)
    } else {
        *max_uses
    };
    let insert = sqlx::query(
        "INSERT INTO community_invitations
            (id, conversation_id, created_by, target_id, token_hash, expires_at, max_uses)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(invitation_id)
    .bind(context.community.id)
    .bind(context.actor.user_id);
    let insert = insert.bind(target_id).bind(hash).bind(expires_at);
    insert.bind(limit).execute(connection).await?;
    Ok(())
}

async fn decide(
    connection: &mut PgConnection,
    context: &CommunityContext<'_>,
) -> Result<(), AcceptanceError> {
    membership::require_manager(connection, context).await?;
    let target = context.command.action.target_user().ok_or(AccountError::NotFound)?;
    let source: Option<Option<Uuid>> = sqlx::query_scalar(
        "SELECT invitation_id FROM community_join_requests WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(context.community.id)
    .bind(target)
    .fetch_optional(&mut *connection)
    .await?;
    let invitation_id = source.ok_or(AccountError::NotFound)?;
    if matches!(context.command.action, CommunityAction::Approve { .. }) {
        return admit(
            connection,
            &Admission {
                community: context.community,
                user_id: target,
                invitation_id,
            },
        )
        .await;
    }
    let reject = sqlx::query(
        "DELETE FROM community_join_requests WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(context.community.id)
    .bind(target);
    reject.execute(connection).await?;
    Ok(())
}

/// Apply invitation and approval changes under the community's serialized membership boundary.
pub(crate) async fn apply(
    connection: &mut PgConnection,
    context: &CommunityContext<'_>,
) -> Result<(), AcceptanceError> {
    match &context.command.action {
        CommunityAction::Join {
            ..
        } => join(connection, context).await,
        CommunityAction::Invite {
            ..
        } => create(connection, context).await,
        CommunityAction::Approve {
            ..
        }
        | CommunityAction::Reject {
            ..
        } => decide(connection, context).await,
        CommunityAction::RevokeInvite {
            invitation_id,
        } => {
            membership::require_manager(connection, context).await?;
            let revoke = sqlx::query(
                "UPDATE community_invitations SET revoked_at = now() WHERE id = $1 AND conversation_id = $2",
            )
            .bind(invitation_id)
            .bind(context.community.id);
            revoke.execute(connection).await?;
            Ok(())
        }
        _ => Err(AccountError::Validation("expected an invitation action").into()),
    }
}
