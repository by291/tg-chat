use serde::Serialize;
use sqlx::{FromRow, PgConnection};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{accounts::AccountError, media::MediaLimits};

#[derive(FromRow, Serialize, ToSchema)]
pub struct StorageUsage {
    account_bytes: String,
    account_limit_bytes: String,
    staging_bytes: String,
    staging_limit_bytes: String,
    original_bytes: String,
    original_limit_bytes: String,
}

async fn lock_budget(connection: &mut PgConnection) -> Result<(), AccountError> {
    sqlx::query("SELECT singleton FROM media_quota_lock WHERE singleton FOR UPDATE")
        .fetch_one(connection)
        .await?;

    Ok(())
}

/// Update a per-account ceiling under the existing reservation budget lock.
pub(crate) async fn set_limit(
    connection: &mut PgConnection,
    user_id: Uuid,
    limit_bytes: Option<String>,
) -> Result<(), AccountError> {
    let limits = MediaLimits::from_env()?;
    let exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)");
    if !exists.bind(user_id).fetch_one(&mut *connection).await? {
        return Err(AccountError::NotFound);
    }
    lock_budget(connection).await?;

    if let Some(value) = limit_bytes {
        let bytes = crate::messages::history::parse_sequence(&value)?;
        if bytes == 0 || bytes > limits.original_bytes {
            return Err(AccountError::Validation(
                "account storage limit exceeds deployment policy",
            ));
        }

        let update = sqlx::query(
            "INSERT INTO account_storage_limits (user_id, limit_bytes) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET limit_bytes = EXCLUDED.limit_bytes",
        );
        update.bind(user_id).bind(bytes).execute(connection).await?;
    } else {
        let delete = sqlx::query("DELETE FROM account_storage_limits WHERE user_id = $1");
        delete.bind(user_id).execute(connection).await?;
    }

    Ok(())
}

/// Read account and deployment usage using the same retained reservations as admission.
pub(crate) async fn usage(
    connection: &mut PgConnection,
    user_id: Uuid,
) -> Result<StorageUsage, AccountError> {
    let limits = MediaLimits::from_env()?;
    let query = sqlx::query_as::<_, StorageUsage>(
        "SELECT
            COALESCE(sum(size_bytes) FILTER (WHERE owner_id = $1), 0)::text AS account_bytes,
            COALESCE((SELECT limit_bytes FROM account_storage_limits WHERE user_id = $1), $2)
                ::text AS account_limit_bytes,
            COALESCE(sum(size_bytes) FILTER (WHERE staging_released_at IS NULL), 0)
                ::text AS staging_bytes,
            $3::bigint::text AS staging_limit_bytes,
            COALESCE(sum(size_bytes), 0)::text AS original_bytes,
            $4::bigint::text AS original_limit_bytes
         FROM media_uploads WHERE released_at IS NULL",
    );
    let query = query.bind(user_id).bind(limits.account_bytes);
    let query = query.bind(limits.staging_bytes).bind(limits.original_bytes);

    Ok(query.fetch_one(connection).await?)
}
