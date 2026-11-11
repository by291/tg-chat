use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{
    AccountError, AccountService, Actor,
    email::EmailService,
    sessions::{ensure_recent, lock_actor, revoke_all},
};
use crate::media::avatars::{AvatarChange, prepare_avatar};

const DELETED_ACCOUNT_NAME: &str = "Deleted account";

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DeleteAccount {
    pub operation_id: Uuid,
    pub confirm_shared_messages: bool,
}

#[derive(Serialize, ToSchema)]
pub struct AccountDeletionReceipt {
    pub operation_id: Uuid,
    pub deleted_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize, ToSchema)]
pub struct OwnedCommunity {
    pub conversation_id: Uuid,
    pub title: String,
}

pub enum AccountDeletionOutcome {
    Deleted(AccountDeletionReceipt),
    OwnsCommunities(Vec<OwnedCommunity>),
}

async fn owned_communities(
    connection: &mut PgConnection,
    user_id: Uuid,
) -> Result<Vec<OwnedCommunity>, sqlx::Error> {
    // Ownership changes serialize on the account. Taking conversation locks here would invert
    // the order used by transfers, so read committed ownership under the account lock alone.
    let query = sqlx::query_as(
        "SELECT id AS conversation_id, title FROM conversations
         WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY id",
    );
    query.bind(user_id).fetch_all(connection).await
}

async fn tombstone(
    connection: &mut PgConnection,
    user_id: Uuid,
) -> Result<DateTime<Utc>, sqlx::Error> {
    let query = sqlx::query_scalar(
        "UPDATE users
         SET deleted_at = clock_timestamp(), is_suspended = true, is_operator = false,
             username = '', password_hash = '', display_name = $2, biography = '',
             phone = NULL, verified_email = NULL, avatar_file_id = NULL,
             direct_message_audience = 'nobody', call_audience = 'nobody',
             presence_audience = 'nobody', profile_version = profile_version + 1,
             credential_version = credential_version + 1, email_version = email_version + 1
         WHERE id = $1 RETURNING deleted_at",
    );
    let query = query.bind(user_id).bind(DELETED_ACCOUNT_NAME);
    query.fetch_one(connection).await
}

impl AccountService {
    /// Retire an account and record its cleanup intent without orphaning owned communities.
    pub async fn delete_account(
        &self,
        actor: &Actor,
        input: DeleteAccount,
    ) -> Result<AccountDeletionOutcome, AccountError> {
        if !input.confirm_shared_messages {
            return Err(AccountError::Validation("confirm retention of shared messages"));
        }

        let mut transaction = self.pool.begin().await?;
        let (user, session) = lock_actor(&mut transaction, actor, &self.settings).await?;
        ensure_recent(&session, &self.settings)?;
        let communities = owned_communities(&mut transaction, actor.user_id).await?;
        if !communities.is_empty() {
            return Ok(AccountDeletionOutcome::OwnsCommunities(communities));
        }

        let avatar = AvatarChange {
            actor_id: actor.user_id,
            previous: user.avatar_file_id,
            next: None,
        };
        prepare_avatar(&mut transaction, avatar).await?;
        let deleted_at = tombstone(&mut transaction, actor.user_id).await?;
        revoke_all(&mut transaction, actor.user_id).await?;
        EmailService::consume_challenges(&mut transaction, actor.user_id).await?;
        let enqueue = sqlx::query(
            "INSERT INTO account_cleanup_jobs (user_id, operation_id, created_at)
             VALUES ($1, $2, $3)",
        );
        let enqueue = enqueue.bind(actor.user_id).bind(input.operation_id).bind(deleted_at);
        enqueue.execute(&mut *transaction).await?;
        transaction.commit().await?;

        Ok(AccountDeletionOutcome::Deleted(AccountDeletionReceipt {
            operation_id: input.operation_id,
            deleted_at,
        }))
    }
}
