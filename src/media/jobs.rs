use std::{path::PathBuf, time::Duration};

use sqlx::{PgConnection, PgPool};
use tokio::time::{sleep, timeout};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::accounts::AccountError;

use super::{
    MediaStorageSettings, MediaVariant, UploadPurpose,
    processing::{PreparationError, PreparedMedia, Processor},
    storage::{MediaStorage, StoredSource, VariantObject},
    transfer::staging_key,
};

const MAX_ATTEMPTS: i32 = 3;
const LEASE_SECONDS: i64 = 150;
const PREPARE_TIMEOUT: Duration = Duration::from_secs(120);
const READY_SECONDS: i64 = 8 * 24 * 60 * 60;
const POLL_DELAY: Duration = Duration::from_secs(1);
const RETRY_SECONDS: i64 = 5;
const MAX_VARIANT_BYTES_PER_ATTEMPT: i64 = 150 * 1024 * 1024;
const DEFAULT_VARIANT_BUDGET: i64 = 512 * 1024 * 1024;

#[derive(Clone)]
pub struct MediaWorkerSettings {
    pub variant_budget_bytes: i64,
    pub processor: PathBuf,
}

pub struct MediaWorker {
    pool: PgPool,
    storage: MediaStorage,
    settings: MediaWorkerSettings,
}

#[derive(sqlx::FromRow)]
struct Job {
    upload_id: Uuid,
    purpose: UploadPurpose,
    size_bytes: i64,
    sha256: String,
    attempts: i32,
}

struct Claim {
    job: Job,
    attempt_id: Uuid,
}

enum RetryPolicy {
    Transient,
    Terminal,
}

struct Publication<'a> {
    claim: &'a Claim,
    media: &'a PreparedMedia,
}

struct VariantRow<'a> {
    file_id: Uuid,
    kind: MediaVariant,
    mime_type: &'a str,
    size_bytes: i64,
}

impl Default for MediaWorkerSettings {
    fn default() -> Self {
        Self {
            variant_budget_bytes: DEFAULT_VARIANT_BUDGET,
            processor: PathBuf::from("/usr/local/bin/media-processor"),
        }
    }
}

impl MediaWorkerSettings {
    /// Parse the deployment-wide derivative budget independently from original uploads.
    pub(crate) fn from_env() -> Result<Self, AccountError> {
        let mut settings = Self::default();
        settings.variant_budget_bytes = super::settings::byte_budget(
            "TG_CHAT_MEDIA_VARIANT_BYTES",
            settings.variant_budget_bytes,
        )?;

        Ok(settings)
    }
}

/// Address a stored variant only inside its server-owned attempt namespace.
pub(super) fn variant_key(file_id: Uuid, kind: MediaVariant) -> String {
    format!("files/{file_id}/{}", kind.object_name())
}

fn map_candidate_error(error: AccountError) -> PreparationError {
    match error {
        AccountError::Validation(_) => PreparationError::Invalid("size_mismatch"),
        _ => PreparationError::Unavailable("storage_unavailable"),
    }
}

async fn write_variant_row(
    connection: &mut PgConnection,
    variant: VariantRow<'_>,
) -> Result<(), sqlx::Error> {
    let query = sqlx::query(
        "INSERT INTO media_variants (file_id, kind, mime_type, size_bytes)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(variant.file_id)
    .bind(variant.kind)
    .bind(variant.mime_type);
    query.bind(variant.size_bytes).execute(connection).await?;

    Ok(())
}

impl MediaWorker {
    /// Create a Worker with the configured private bucket and processor.
    pub fn new(pool: PgPool, storage: MediaStorageSettings, settings: MediaWorkerSettings) -> Self {
        Self {
            pool,
            storage: MediaStorage::new(storage),
            settings,
        }
    }

    /// Claim and prepare one upload, leaving interrupted work recoverable by lease expiry.
    pub async fn process_next(&self) -> Result<bool, AccountError> {
        let Some(claim) = self.claim().await? else {
            return Ok(false);
        };
        if claim.job.attempts > MAX_ATTEMPTS {
            self.finish_failed(&claim, "processing_attempts_exhausted", RetryPolicy::Terminal)
                .await?;
            return Ok(true);
        }

        let result = timeout(PREPARE_TIMEOUT, self.prepare(&claim)).await;
        match result {
            Ok(Ok(media)) => {
                self.publish(Publication {
                    claim: &claim,
                    media: &media,
                })
                .await?
            }
            Ok(Err(PreparationError::Invalid(code))) => {
                self.finish_failed(&claim, code, RetryPolicy::Terminal).await?;
            }
            Ok(Err(PreparationError::Unavailable(code))) => {
                self.finish_failed(&claim, code, RetryPolicy::Transient).await?;
            }
            Err(_) => {
                self.finish_failed(&claim, "processing_timeout", RetryPolicy::Transient).await?
            }
        }

        Ok(true)
    }

    /// Run one bounded processor per Worker until runtime shutdown.
    pub async fn run(&self, shutdown: CancellationToken) {
        loop {
            let result = tokio::select! {
                () = shutdown.cancelled() => break,
                result = self.process_next() => result,
            };
            match result {
                Ok(true) => continue,
                Ok(false) => {}
                Err(_) => tracing::warn!("media_preparation_unavailable"),
            }

            tokio::select! {
                () = shutdown.cancelled() => break,
                () = sleep(POLL_DELAY) => {}
            }
        }
    }

    async fn claim(&self) -> Result<Option<Claim>, AccountError> {
        let mut transaction = self.pool.begin().await?;
        // The reservation covers one candidate original, so retries wait for prior cleanup.
        let job = sqlx::query_as::<_, Job>(
            "SELECT upload.id AS upload_id, upload.purpose, upload.size_bytes, upload.sha256,
                    job.attempts
             FROM media_preparation_jobs job
             JOIN media_uploads upload ON upload.id = job.upload_id
             WHERE upload.state IN ('uploaded', 'processing')
               AND job.available_at <= now()
               AND (job.lease_until IS NULL OR job.lease_until <= now())
               AND NOT EXISTS (SELECT 1 FROM media_processing_attempts previous
                   WHERE previous.upload_id = upload.id AND previous.released_at IS NULL)
             ORDER BY job.available_at, upload.id
             LIMIT 1 FOR UPDATE OF upload SKIP LOCKED",
        );
        let Some(mut job) = job.fetch_optional(&mut *transaction).await? else {
            return Ok(None);
        };

        // An attempt owns a fresh key namespace before any S3 copies or derivatives are written.
        let attempt_id = Uuid::new_v4();
        let update = sqlx::query(
            "UPDATE media_preparation_jobs
             SET lease_id = $2,
                 lease_until = clock_timestamp() + ($3::bigint * interval '1 second'),
                 attempts = attempts + 1
             WHERE upload_id = $1 AND (lease_until IS NULL OR lease_until <= clock_timestamp())",
        )
        .bind(job.upload_id)
        .bind(attempt_id)
        .bind(LEASE_SECONDS);
        let claimed = update.execute(&mut *transaction).await?.rows_affected();
        if claimed == 0 {
            return Ok(None);
        }

        let attempt =
            sqlx::query("INSERT INTO media_processing_attempts (id, upload_id) VALUES ($1, $2)");
        let attempt = attempt.bind(attempt_id).bind(job.upload_id);
        attempt.execute(&mut *transaction).await?;

        let upload = sqlx::query("UPDATE media_uploads SET state = 'processing' WHERE id = $1");
        upload.bind(job.upload_id).execute(&mut *transaction).await?;
        transaction.commit().await?;

        job.attempts += 1;
        Ok(Some(Claim {
            job,
            attempt_id,
        }))
    }

    async fn prepare(&self, claim: &Claim) -> Result<PreparedMedia, PreparationError> {
        self.storage.provision().await.map_err(map_candidate_error)?;
        let scratch = tempfile::tempdir()
            .map_err(|_| PreparationError::Unavailable("scratch_unavailable"))?;
        let path = scratch.path().join("original");
        let key = variant_key(claim.attempt_id, MediaVariant::Original);
        let staging = staging_key(claim.job.upload_id);
        self.storage.copy_candidate(&staging, &key).await.map_err(map_candidate_error)?;

        let source = StoredSource {
            key: &key,
            path: &path,
            size_bytes: claim.job.size_bytes,
        };
        let digest = self.storage.download_candidate(source).await.map_err(map_candidate_error)?;
        if digest != claim.job.sha256 {
            return Err(PreparationError::Invalid("digest_mismatch"));
        }

        let processor = Processor {
            executable: self.settings.processor.clone(),
        };
        let media = processor.prepare(&path, claim.job.purpose).await?;
        self.store_variants(claim, &media).await?;

        Ok(media)
    }

    async fn store_variants(
        &self,
        claim: &Claim,
        media: &PreparedMedia,
    ) -> Result<(), PreparationError> {
        let bytes: i64 = media.variants.iter().map(|variant| variant.size_bytes).sum();
        if bytes > MAX_VARIANT_BYTES_PER_ATTEMPT {
            return Err(PreparationError::Invalid("variant_size_limit"));
        }
        if bytes == 0 {
            return Ok(());
        }
        self.reserve_variant_bytes(claim, bytes).await?;

        for derivative in &media.variants {
            let key = variant_key(claim.attempt_id, derivative.kind);
            let variant = VariantObject {
                key: &key,
                path: &derivative.path,
                size_bytes: derivative.size_bytes,
                mime_type: derivative.mime_type,
            };
            self.storage.put_variant(variant).await.map_err(map_candidate_error)?;
        }

        Ok(())
    }

    async fn reserve_variant_bytes(
        &self,
        claim: &Claim,
        bytes: i64,
    ) -> Result<(), PreparationError> {
        let record_error = |_| PreparationError::Unavailable("variant_accounting_unavailable");
        let mut transaction = self.pool.begin().await.map_err(record_error)?;
        if !is_current(&mut transaction, claim).await.map_err(record_error)? {
            return Err(PreparationError::Unavailable("processing_lease_lost"));
        }

        let budget =
            sqlx::query("SELECT singleton FROM media_quota_lock WHERE singleton FOR UPDATE");
        budget.fetch_one(&mut *transaction).await.map_err(record_error)?;

        // Attempts remain charged while orphan variants can still occupy storage.
        let used: i64 = sqlx::query_scalar(
            "SELECT COALESCE(sum(variant_bytes), 0)::bigint
             FROM media_processing_attempts WHERE released_at IS NULL",
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(record_error)?;
        if used > self.settings.variant_budget_bytes - bytes {
            return Err(PreparationError::Unavailable("variant_budget_full"));
        }

        let update =
            sqlx::query("UPDATE media_processing_attempts SET variant_bytes = $2 WHERE id = $1");
        let update = update.bind(claim.attempt_id).bind(bytes);
        update.execute(&mut *transaction).await.map_err(record_error)?;
        transaction.commit().await.map_err(record_error)?;

        Ok(())
    }

    async fn publish(&self, publication: Publication<'_>) -> Result<(), AccountError> {
        let mut transaction = self.pool.begin().await?;
        if !is_current(&mut transaction, publication.claim).await? {
            return Ok(());
        }

        let claim = publication.claim;
        let media = publication.media;
        let file = sqlx::query(
            "INSERT INTO media_files
                (id, upload_id, size_bytes, width, height, duration_ms, waveform, ready_until)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8::bigint * interval '1 second'))",
        )
        .bind(claim.attempt_id)
        .bind(claim.job.upload_id)
        .bind(claim.job.size_bytes);
        let file = file.bind(media.width).bind(media.height).bind(media.duration_ms);
        let file = file.bind(&media.waveform).bind(READY_SECONDS);
        file.execute(&mut *transaction).await?;

        write_variant_row(
            &mut transaction,
            VariantRow {
                file_id: claim.attempt_id,
                kind: MediaVariant::Original,
                mime_type: media.mime_type,
                size_bytes: claim.job.size_bytes,
            },
        )
        .await?;
        for variant in &media.variants {
            write_variant_row(
                &mut transaction,
                VariantRow {
                    file_id: claim.attempt_id,
                    kind: variant.kind,
                    mime_type: variant.mime_type,
                    size_bytes: variant.size_bytes,
                },
            )
            .await?;
        }

        let upload =
            sqlx::query("UPDATE media_uploads SET state = 'ready', file_id = $2 WHERE id = $1");
        let upload = upload.bind(claim.job.upload_id).bind(claim.attempt_id);
        upload.execute(&mut *transaction).await?;
        delete_job(&mut transaction, claim.job.upload_id).await?;
        transaction.commit().await?;

        Ok(())
    }

    async fn finish_failed(
        &self,
        claim: &Claim,
        error_code: &'static str,
        retry_policy: RetryPolicy,
    ) -> Result<(), AccountError> {
        let mut transaction = self.pool.begin().await?;
        if !is_current(&mut transaction, claim).await? {
            return Ok(());
        }

        let can_retry =
            matches!(retry_policy, RetryPolicy::Transient) && claim.job.attempts < MAX_ATTEMPTS;
        if can_retry {
            let reschedule = sqlx::query(
                "UPDATE media_preparation_jobs
                 SET lease_id = NULL, lease_until = NULL,
                     available_at = now() + ($2::bigint * interval '1 second')
                 WHERE upload_id = $1",
            )
            .bind(claim.job.upload_id)
            .bind(RETRY_SECONDS);
            reschedule.execute(&mut *transaction).await?;
        } else {
            let reject = sqlx::query(
                "UPDATE media_uploads SET state = 'rejected', error_code = $2 WHERE id = $1",
            )
            .bind(claim.job.upload_id)
            .bind(error_code);
            reject.execute(&mut *transaction).await?;
            delete_job(&mut transaction, claim.job.upload_id).await?;
        }
        transaction.commit().await?;

        Ok(())
    }
}

async fn is_current(connection: &mut PgConnection, claim: &Claim) -> Result<bool, sqlx::Error> {
    // Lock the upload first so cancellation and publication have a single winner.
    let locked = sqlx::query(
        "SELECT id FROM media_uploads WHERE id = $1 AND state = 'processing' FOR UPDATE",
    )
    .bind(claim.job.upload_id);
    if locked.fetch_optional(&mut *connection).await?.is_none() {
        return Ok(false);
    }

    let query = sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM media_preparation_jobs
             WHERE upload_id = $1 AND lease_id = $2 AND lease_until > clock_timestamp()
         )",
    )
    .bind(claim.job.upload_id)
    .bind(claim.attempt_id);
    query.fetch_one(connection).await
}

async fn delete_job(connection: &mut PgConnection, upload_id: Uuid) -> Result<(), sqlx::Error> {
    let delete = sqlx::query("DELETE FROM media_preparation_jobs WHERE upload_id = $1");
    delete.bind(upload_id).execute(connection).await?;

    Ok(())
}
