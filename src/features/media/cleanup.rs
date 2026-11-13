use std::time::Duration;

use sqlx::{FromRow, PgConnection, PgPool};
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::features::accounts::AccountError;

use super::{
    MediaStorageSettings, MediaVariant, jobs::variant_key, settings::CLEANUP_GRACE_SECONDS,
    storage::MediaStorage, transfer::staging_key,
};

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const RETRY_SECONDS: i64 = 90;
const RECEIPT_BATCH_SIZE: i64 = 100;

const DERIVATIVES: [MediaVariant; 3] =
    [MediaVariant::Thumbnail, MediaVariant::Poster, MediaVariant::Playback];

pub struct MediaCleanup {
    pool: PgPool,
    storage: MediaStorage,
}

#[derive(FromRow)]
struct Candidate {
    id: Uuid,
    upload_id: Uuid,
}

async fn lock_upload(connection: &mut PgConnection, upload_id: Uuid) -> Result<(), sqlx::Error> {
    let lock = sqlx::query("SELECT id FROM media_uploads WHERE id = $1 FOR UPDATE");
    lock.bind(upload_id).fetch_one(connection).await?;

    Ok(())
}

async fn release_upload(connection: &mut PgConnection, upload_id: Uuid) -> Result<(), sqlx::Error> {
    // Release only after every path that can still occupy bytes has completed physical cleanup.
    let update = sqlx::query(
        "UPDATE media_uploads upload SET released_at = now()
         WHERE upload.id = $1 AND upload.released_at IS NULL
           AND upload.staging_released_at IS NOT NULL
           AND upload.state IN ('rejected', 'cancelled', 'expired')
           AND NOT EXISTS (SELECT 1 FROM media_processing_attempts attempt
               WHERE attempt.upload_id = upload.id AND attempt.released_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM media_files file
               WHERE file.upload_id = upload.id AND file.deleted_at IS NULL)",
    );
    update.bind(upload_id).execute(connection).await?;

    Ok(())
}

impl MediaCleanup {
    /// Use the same bucket and PostgreSQL ownership records as the upload Worker.
    pub fn new(pool: PgPool, storage: MediaStorageSettings) -> Self {
        Self {
            pool,
            storage: MediaStorage::new(storage),
        }
    }

    /// Collect one due item from each category so abandoned uploads cannot starve.
    pub async fn process_next(&self) -> Result<bool, AccountError> {
        let file = self.collect_file().await;
        let derivatives = self.collect_derivatives().await;
        let attempt = self.collect_attempt().await;
        let staging = self.collect_staging().await;
        let has_collected_file = file?;
        let has_collected_derivatives = derivatives?;
        let has_collected_attempt = attempt?;
        let has_collected_staging = staging?;

        Ok(has_collected_file
            || has_collected_derivatives
            || has_collected_attempt
            || has_collected_staging)
    }

    /// Keep physical cleanup independent of transfer and codec processing.
    pub async fn run(&self, shutdown: CancellationToken) {
        loop {
            let result = tokio::select! {
                () = shutdown.cancelled() => break,
                result = self.process_next() => result,
            };
            if result.is_err() {
                tracing::warn!("media_collection_unavailable");
            }
            if let Err(error) = self.prune_receipts().await {
                tracing::warn!(%error, "media_receipt_cleanup_unavailable");
            }

            tokio::select! {
                () = shutdown.cancelled() => break,
                () = sleep(POLL_INTERVAL) => {}
            }
        }
    }

    async fn claim_file(&self) -> Result<Option<Candidate>, AccountError> {
        let mut transaction = self.pool.begin().await?;
        let query = sqlx::query_as::<_, Candidate>(
            "SELECT file.id, file.upload_id FROM media_files file
             WHERE file.deleted_at IS NULL
               AND (file.cleanup_after IS NULL OR file.cleanup_after <= now())
               AND (file.deleting_at IS NOT NULL OR (
                    file.ready_until <= now() AND NOT EXISTS (
                        SELECT 1 FROM media_live_file_references reference
                        WHERE reference.file_id = file.id
                    ) AND NOT EXISTS (
                        SELECT 1 FROM media_evidence_references evidence
                        WHERE evidence.file_id = file.id
                    )
               ))
             ORDER BY file.ready_until, file.id LIMIT 1 FOR UPDATE OF file SKIP LOCKED",
        );
        let candidate = query.fetch_optional(&mut *transaction).await?;
        let Some(candidate) = candidate else {
            return Ok(None);
        };

        // A reference can commit while a scan is finding its candidate. Recheck under its lock.
        let update = sqlx::query(
            "UPDATE media_files file SET deleting_at = COALESCE(deleting_at, now()),
                 cleanup_after = now() + ($2::bigint * interval '1 second')
             WHERE file.id = $1 AND NOT EXISTS (
                 SELECT 1 FROM media_live_file_references reference
                 WHERE reference.file_id = file.id
             ) AND NOT EXISTS (
                 SELECT 1 FROM media_evidence_references evidence
                 WHERE evidence.file_id = file.id
             )",
        )
        .bind(candidate.id)
        .bind(RETRY_SECONDS);
        if update.execute(&mut *transaction).await?.rows_affected() == 0 {
            return Ok(None);
        }
        transaction.commit().await?;

        Ok(Some(candidate))
    }

    async fn collect_file(&self) -> Result<bool, AccountError> {
        let Some(candidate) = self.claim_file().await? else {
            return Ok(false);
        };
        self.delete_candidate_objects(candidate.id).await?;

        let mut transaction = self.pool.begin().await?;
        lock_upload(&mut transaction, candidate.upload_id).await?;
        let file = sqlx::query("UPDATE media_files SET deleted_at = now() WHERE id = $1");
        file.bind(candidate.id).execute(&mut *transaction).await?;
        release_attempt(&mut transaction, candidate.id).await?;
        let upload =
            sqlx::query("UPDATE media_uploads SET state = 'expired', file_id = NULL WHERE id = $1");
        upload.bind(candidate.upload_id).execute(&mut *transaction).await?;
        release_upload(&mut transaction, candidate.upload_id).await?;
        transaction.commit().await?;

        Ok(true)
    }

    async fn claim_derivatives(&self) -> Result<Option<Uuid>, AccountError> {
        let mut transaction = self.pool.begin().await?;
        let query = sqlx::query_scalar::<_, Uuid>(
            "SELECT file.id FROM media_files file
             WHERE file.deleted_at IS NULL AND file.deleting_at IS NULL
               AND file.ready_until <= now()
               AND (file.cleanup_after IS NULL OR file.cleanup_after <= now())
               AND EXISTS (
                   SELECT 1 FROM media_evidence_references evidence
                   WHERE evidence.file_id = file.id
               ) AND NOT EXISTS (
                   SELECT 1 FROM media_live_file_references reference
                   WHERE reference.file_id = file.id
               ) AND EXISTS (
                   SELECT 1 FROM media_variants variant
                   WHERE variant.file_id = file.id AND variant.kind <> 'original'
               )
             ORDER BY file.ready_until, file.id LIMIT 1 FOR UPDATE OF file SKIP LOCKED",
        );
        let Some(file_id) = query.fetch_optional(&mut *transaction).await? else {
            return Ok(None);
        };

        // Fence ordinary reuse while deletion is pending, and recheck holds under the file lock.
        let claim = sqlx::query(
            "UPDATE media_files file
             SET derivatives_deleting_at = COALESCE(derivatives_deleting_at, now()),
                 cleanup_after = now() + ($2::bigint * interval '1 second')
             WHERE file.id = $1 AND EXISTS (
                 SELECT 1 FROM media_evidence_references evidence WHERE evidence.file_id = file.id
             ) AND NOT EXISTS (
                 SELECT 1 FROM media_live_file_references reference WHERE reference.file_id = file.id
             )",
        );
        let claim = claim.bind(file_id).bind(RETRY_SECONDS);
        if claim.execute(&mut *transaction).await?.rows_affected() == 0 {
            return Ok(None);
        }
        transaction.commit().await?;

        Ok(Some(file_id))
    }

    async fn collect_derivatives(&self) -> Result<bool, AccountError> {
        let Some(file_id) = self.claim_derivatives().await? else {
            return Ok(false);
        };
        self.delete_derivative_objects(file_id).await?;

        let mut transaction = self.pool.begin().await?;
        // A full cleanup may have taken over after the retry deadline. Preserve its lease.
        let finish = sqlx::query(
            "UPDATE media_files
             SET cleanup_after = CASE WHEN deleting_at IS NULL THEN NULL ELSE cleanup_after END
             WHERE id = $1",
        );
        finish.bind(file_id).execute(&mut *transaction).await?;
        let variants =
            sqlx::query("DELETE FROM media_variants WHERE file_id = $1 AND kind <> 'original'");
        variants.bind(file_id).execute(&mut *transaction).await?;
        let release =
            sqlx::query("UPDATE media_processing_attempts SET variant_bytes = 0 WHERE id = $1");
        release.bind(file_id).execute(&mut *transaction).await?;
        transaction.commit().await?;

        Ok(true)
    }

    async fn collect_attempt(&self) -> Result<bool, AccountError> {
        let claim = sqlx::query_as::<_, Candidate>(
            "UPDATE media_processing_attempts attempt
             SET cleanup_after = now() + ($2::bigint * interval '1 second')
             WHERE id = (
                SELECT candidate.id FROM media_processing_attempts candidate
                WHERE candidate.released_at IS NULL
                  AND candidate.created_at + ($1::bigint * interval '1 second') <= now()
                  AND (candidate.cleanup_after IS NULL OR candidate.cleanup_after <= now())
                  AND NOT EXISTS (SELECT 1 FROM media_files file WHERE file.id = candidate.id)
                  AND NOT EXISTS (SELECT 1 FROM media_preparation_jobs job
                      WHERE job.lease_id = candidate.id AND job.lease_until > now())
                ORDER BY candidate.created_at, candidate.id LIMIT 1
                FOR UPDATE OF candidate SKIP LOCKED
             ) RETURNING attempt.id, attempt.upload_id",
        )
        .bind(CLEANUP_GRACE_SECONDS)
        .bind(RETRY_SECONDS);
        let Some(candidate) = claim.fetch_optional(&self.pool).await? else {
            return Ok(false);
        };
        self.delete_candidate_objects(candidate.id).await?;

        let mut transaction = self.pool.begin().await?;
        lock_upload(&mut transaction, candidate.upload_id).await?;
        release_attempt(&mut transaction, candidate.id).await?;
        release_upload(&mut transaction, candidate.upload_id).await?;
        transaction.commit().await?;

        Ok(true)
    }

    async fn collect_staging(&self) -> Result<bool, AccountError> {
        let claim = sqlx::query_scalar::<_, Uuid>(
            "UPDATE media_uploads upload
             SET state = CASE WHEN state = 'reserved' THEN 'expired'::media_upload_state
                              ELSE state END,
                 cleanup_after = now() + ($2::bigint * interval '1 second')
             WHERE id = (
                SELECT candidate.id FROM media_uploads candidate
                WHERE candidate.staging_released_at IS NULL
                  AND (candidate.state IN ('ready', 'rejected', 'cancelled', 'expired')
                       OR (candidate.state = 'reserved' AND candidate.expires_at <= now())
                  )
                  AND (candidate.last_write_expires_at IS NULL OR
                       candidate.last_write_expires_at
                           + ($1::bigint * interval '1 second') <= now())
                  AND (candidate.claim_until IS NULL OR candidate.claim_until <= now())
                  AND (candidate.cleanup_after IS NULL OR candidate.cleanup_after <= now())
                ORDER BY candidate.expires_at, candidate.id LIMIT 1
                FOR UPDATE OF candidate SKIP LOCKED
             ) RETURNING upload.id",
        )
        .bind(CLEANUP_GRACE_SECONDS)
        .bind(RETRY_SECONDS);
        let Some(upload_id) = claim.fetch_optional(&self.pool).await? else {
            return Ok(false);
        };
        let key = staging_key(upload_id);
        self.storage.provision().await?;
        self.storage.abort_staging(&key).await?;
        self.storage.delete_object(&key).await?;

        let mut transaction = self.pool.begin().await?;
        lock_upload(&mut transaction, upload_id).await?;
        let release = sqlx::query(
            "UPDATE media_uploads SET staging_released_at = now(), multipart_id = NULL
             WHERE id = $1",
        );
        release.bind(upload_id).execute(&mut *transaction).await?;
        let cancelled_job = sqlx::query(
            "DELETE FROM media_preparation_jobs WHERE upload_id = $1
             AND EXISTS (SELECT 1 FROM media_uploads WHERE id = $1 AND state = 'cancelled')",
        );
        cancelled_job.bind(upload_id).execute(&mut *transaction).await?;
        release_upload(&mut transaction, upload_id).await?;
        transaction.commit().await?;

        Ok(true)
    }

    async fn delete_candidate_objects(&self, id: Uuid) -> Result<(), AccountError> {
        self.delete_derivative_objects(id).await?;
        let key = variant_key(id, MediaVariant::Original);
        self.storage.delete_object(&key).await
    }

    async fn delete_derivative_objects(&self, id: Uuid) -> Result<(), AccountError> {
        self.storage.provision().await?;
        for variant in DERIVATIVES {
            let key = variant_key(id, variant);
            self.storage.delete_object(&key).await?;
        }

        Ok(())
    }

    async fn prune_receipts(&self) -> Result<(), sqlx::Error> {
        let delete = sqlx::query(
            "DELETE FROM media_avatar_receipts WHERE (owner_id, operation_id) IN (
                SELECT owner_id, operation_id FROM media_avatar_receipts
                WHERE created_at < now() - interval '7 days'
                ORDER BY created_at LIMIT $1
            )",
        );
        delete.bind(RECEIPT_BATCH_SIZE).execute(&self.pool).await?;

        Ok(())
    }
}

async fn release_attempt(connection: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    let release =
        sqlx::query("UPDATE media_processing_attempts SET released_at = now() WHERE id = $1");
    release.bind(id).execute(connection).await?;

    Ok(())
}
