use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

use crate::accounts::{AccountError, AccountService, Actor, sessions::lock_actor};

use super::{
    MediaLimits, ReserveUpload, UploadStatus, model::UploadRecord, settings::RESERVATION_SECONDS,
};

#[derive(Clone)]
pub struct UploadReservations {
    pub(super) accounts: AccountService,
    limits: MediaLimits,
}

#[derive(FromRow)]
struct AccountAllocation {
    bytes: i64,
    active_uploads: i64,
}

impl UploadReservations {
    /// Bind media reservations to the account session and configured byte budgets.
    pub fn new(accounts: AccountService, limits: MediaLimits) -> Self {
        Self {
            accounts,
            limits,
        }
    }

    /// Reserve quota once for an actor-owned upload ID and replay matching requests.
    pub async fn reserve(
        &self,
        actor: &Actor,
        request: ReserveUpload,
    ) -> Result<UploadStatus, AccountError> {
        request.validate()?;

        let mut transaction = self.accounts.pool.begin().await?;
        lock_actor(&mut transaction, actor, &self.accounts.settings).await?;
        let previous = find_owned(&mut transaction, actor, request.upload_id).await?;
        if let Some(previous) = previous {
            if !previous.matches(&request) {
                return Err(AccountError::Conflict);
            }
            return Ok(previous.status());
        }

        self.check_quota(&mut transaction, actor, request.size_bytes).await?;
        let record = insert_reservation(&mut transaction, actor, request).await?;
        transaction.commit().await?;

        Ok(record.status())
    }

    /// Read the current upload state only within the session that reserved it.
    pub async fn status(
        &self,
        actor: &Actor,
        upload_id: Uuid,
    ) -> Result<UploadStatus, AccountError> {
        let mut connection = self.accounts.pool.acquire().await?;
        let record = find_owned(&mut connection, actor, upload_id).await?;
        let record = record.ok_or(AccountError::NotFound)?;

        Ok(record.status())
    }

    /// Close an upload to new writes and let the collector reclaim stored bytes.
    pub async fn cancel(
        &self,
        actor: &Actor,
        upload_id: Uuid,
    ) -> Result<UploadStatus, AccountError> {
        let mut transaction = self.accounts.pool.begin().await?;
        lock_actor(&mut transaction, actor, &self.accounts.settings).await?;

        // Cancellation shares the upload row lock with claim and publication transitions.
        let update = sqlx::query_as::<_, UploadRecord>(
            "UPDATE media_uploads
             SET state = 'cancelled', claim_id = NULL, claim_until = NULL
             WHERE id = $1 AND owner_id = $2 AND session_id = $3
               AND state IN ('reserved', 'uploaded', 'processing')
             RETURNING *, expires_at <= now() AS is_expired",
        )
        .bind(upload_id)
        .bind(actor.user_id)
        .bind(actor.session_id);
        let record = update.fetch_optional(&mut *transaction).await?;
        let record = match record {
            Some(record) => record,
            None => find_owned(&mut transaction, actor, upload_id)
                .await?
                .ok_or(AccountError::NotFound)?,
        };
        transaction.commit().await?;

        Ok(record.status())
    }

    async fn check_quota(
        &self,
        connection: &mut PgConnection,
        actor: &Actor,
        size_bytes: i64,
    ) -> Result<(), AccountError> {
        // Account locking also orders session mutations before deployment-wide admission.
        sqlx::query("SELECT singleton FROM media_quota_lock WHERE singleton FOR UPDATE")
            .fetch_one(&mut *connection)
            .await?;

        let allocation = sqlx::query_as::<_, AccountAllocation>(
            "SELECT COALESCE(sum(size_bytes), 0)::bigint AS bytes,
                    count(*) FILTER (WHERE state IN ('reserved', 'uploaded', 'processing')
                        AND expires_at > now()) AS active_uploads
             FROM media_uploads WHERE owner_id = $1 AND released_at IS NULL",
        )
        .bind(actor.user_id);
        let allocation = allocation.fetch_one(&mut *connection).await?;
        let is_account_full = allocation.bytes > self.limits.account_bytes - size_bytes
            || allocation.active_uploads >= self.limits.active_uploads_per_account;
        if is_account_full {
            return Err(AccountError::QuotaExceeded);
        }

        let staging_bytes: i64 = sqlx::query_scalar(
            "SELECT COALESCE(sum(size_bytes), 0)::bigint
             FROM media_uploads WHERE released_at IS NULL",
        )
        .fetch_one(connection)
        .await?;
        if staging_bytes > self.limits.staging_bytes - size_bytes {
            return Err(AccountError::QuotaExceeded);
        }

        Ok(())
    }
}

/// Fetch an upload only within its original session scope.
pub(super) async fn find_owned(
    connection: &mut PgConnection,
    actor: &Actor,
    upload_id: Uuid,
) -> Result<Option<UploadRecord>, sqlx::Error> {
    let query = sqlx::query_as::<_, UploadRecord>(
        "SELECT *, expires_at <= now() AS is_expired
         FROM media_uploads WHERE id = $1 AND owner_id = $2 AND session_id = $3",
    )
    .bind(upload_id)
    .bind(actor.user_id)
    .bind(actor.session_id);

    query.fetch_optional(connection).await
}

async fn insert_reservation(
    connection: &mut PgConnection,
    actor: &Actor,
    request: ReserveUpload,
) -> Result<UploadRecord, AccountError> {
    let query = sqlx::query_as::<_, UploadRecord>(
        "INSERT INTO media_uploads
            (id, owner_id, session_id, purpose, file_name, size_bytes, sha256, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8::bigint * interval '1 second'))
         ON CONFLICT (id) DO NOTHING
         RETURNING *, expires_at <= now() AS is_expired",
    )
    .bind(request.upload_id)
    .bind(actor.user_id)
    .bind(actor.session_id);
    let query = query.bind(request.purpose).bind(request.file_name).bind(request.size_bytes);
    let query = query.bind(request.sha256).bind(RESERVATION_SECONDS);
    let record = query.fetch_optional(connection).await?;

    record.ok_or(AccountError::NotFound)
}
