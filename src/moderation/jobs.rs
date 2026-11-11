use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::accounts::AccountError;

const PAGE_SIZE: i64 = 50;

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OperatorJobKind {
    Mail,
    SyncWakeup,
    Media,
    Push,
}

#[derive(FromRow, Serialize, ToSchema)]
pub struct OperatorJob {
    id: Uuid,
    status: String,
    attempts: i32,
    recorded_at: chrono::DateTime<chrono::Utc>,
    failure_code: String,
    can_retry: bool,
}

/// Inspect safe exhausted-job summaries without returning stored delivery payloads.
pub(crate) async fn list(
    connection: &mut PgConnection,
    kind: OperatorJobKind,
) -> Result<Vec<OperatorJob>, AccountError> {
    let statement = match kind {
        OperatorJobKind::Mail => {
            "SELECT job.id, job.status, job.attempts,
                coalesce(job.finished_at, job.created_at) AS recorded_at,
                'delivery_attempts_exhausted'::text AS failure_code,
                octet_length(job.ciphertext) > 0 AND challenge.consumed_at IS NULL
                    AND challenge.expires_at > clock_timestamp() AS can_retry
             FROM mail_jobs job JOIN email_challenges challenge ON challenge.id = job.challenge_id
             WHERE job.status = 'exhausted' ORDER BY recorded_at DESC, job.id LIMIT $1"
        }
        OperatorJobKind::SyncWakeup => {
            "SELECT user_id AS id, status, attempts, updated_at AS recorded_at,
                coalesce(last_error, 'delivery_attempts_exhausted') AS failure_code,
                true AS can_retry
             FROM sync_wakeups WHERE status = 'exhausted'
             ORDER BY recorded_at DESC, user_id LIMIT $1"
        }
        OperatorJobKind::Media => {
            "SELECT id, state::text AS status, 0::integer AS attempts, created_at AS recorded_at,
                coalesce(error_code, 'media_rejected') AS failure_code,
                staging_released_at IS NULL AND cleanup_after IS NULL AND
                    COALESCE(error_code IN ('processing_attempts_exhausted', 'processing_timeout',
                        'storage_unavailable'), false) AS can_retry
             FROM media_uploads WHERE state = 'rejected'
             ORDER BY recorded_at DESC, id LIMIT $1"
        }
        OperatorJobKind::Push => {
            "SELECT id, status, attempts, finished_at AS recorded_at,
                'delivery_attempts_exhausted'::text AS failure_code,
                expires_at > clock_timestamp() AND EXISTS (
                    SELECT 1 FROM push_subscriptions WHERE id = push_deliveries.subscription_id
                ) AS can_retry
             FROM push_deliveries WHERE status = 'exhausted'
             ORDER BY recorded_at DESC, id LIMIT $1"
        }
    };
    let query = sqlx::query_as::<_, OperatorJob>(statement);

    Ok(query.bind(PAGE_SIZE).fetch_all(connection).await?)
}

/// Requeue an exhausted job only while its original delivery prerequisites still hold.
pub(crate) async fn retry(
    connection: &mut PgConnection,
    kind: OperatorJobKind,
    job_id: Uuid,
) -> Result<(), AccountError> {
    let changed = match kind {
        OperatorJobKind::SyncWakeup => {
            crate::jobs::wakeups::retry_exhausted(connection, job_id).await?
        }
        OperatorJobKind::Mail => retry_mail(connection, job_id).await?,
        OperatorJobKind::Media => retry_media(connection, job_id).await?,
        OperatorJobKind::Push => {
            crate::notifications::delivery::retry_exhausted(connection, job_id).await?
        }
    };
    if !changed {
        return Err(AccountError::MessageConflict);
    }

    Ok(())
}

async fn retry_mail(connection: &mut PgConnection, job_id: Uuid) -> Result<bool, AccountError> {
    let update = sqlx::query(
        "UPDATE mail_jobs job SET status = 'pending', attempts = 0,
             available_at = clock_timestamp(), finished_at = NULL
         FROM email_challenges challenge JOIN users account ON account.id = challenge.user_id
         WHERE job.id = $1 AND job.status = 'exhausted' AND job.challenge_id = challenge.id
           AND octet_length(job.ciphertext) > 0
           AND challenge.consumed_at IS NULL AND challenge.expires_at > clock_timestamp()
           AND challenge.credential_version = account.credential_version
           AND challenge.email_version = account.email_version AND NOT account.is_suspended
           AND (challenge.purpose <> 'recovery' OR challenge.target_email = account.verified_email)",
    );
    Ok(update.bind(job_id).execute(connection).await?.rows_affected() == 1)
}

async fn retry_media(connection: &mut PgConnection, upload_id: Uuid) -> Result<bool, AccountError> {
    // The upload lock makes this transition mutually exclusive with staging collection.
    let update = sqlx::query(
        "UPDATE media_uploads SET state = 'processing', error_code = NULL
         WHERE id = $1 AND state = 'rejected' AND staging_released_at IS NULL
           AND cleanup_after IS NULL
           AND error_code IN ('processing_attempts_exhausted', 'processing_timeout',
               'storage_unavailable')",
    );
    let changed = update.bind(upload_id).execute(&mut *connection).await?.rows_affected() == 1;
    if !changed {
        return Ok(false);
    }

    let job = sqlx::query("INSERT INTO media_preparation_jobs (upload_id) VALUES ($1)");
    job.bind(upload_id).execute(connection).await?;

    Ok(true)
}
