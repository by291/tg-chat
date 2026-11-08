//! Coalesced PostgreSQL wakeups with expiring leases and fenced acknowledgements.

use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::accounts::AccountError;

const MAX_ATTEMPTS: i32 = 5;
const LEASE_SECONDS: i64 = 30;
const RETRY_SECONDS: i64 = 2;
const INSPECTION_LIMIT: i64 = 100;

#[derive(Clone)]
pub struct WakeupQueue {
    pool: PgPool,
}

#[derive(FromRow)]
pub struct WakeupClaim {
    pub user_id: Uuid,
    pub position: i64,
    pub lease_token: Uuid,
}

#[derive(FromRow, Serialize)]
pub struct ExhaustedWakeup {
    pub user_id: Uuid,
    pub position: String,
    pub attempts: i32,
    pub last_error: Option<String>,
}

pub enum WakeupOutcome {
    Published,
    Retry,
}

impl WakeupQueue {
    /// Share the durable queue without coupling business transactions to the realtime service.
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
        }
    }

    /// Claim one due wakeup while fencing workers whose final lease expired during publication.
    pub async fn claim(&self) -> Result<Option<WakeupClaim>, AccountError> {
        sqlx::query(
            "UPDATE sync_wakeups SET status = 'exhausted', last_error = 'lease_expired',
             lease_token = NULL, lease_until = NULL
             WHERE status = 'running' AND lease_until <= now() AND attempts >= $1",
        )
        .bind(MAX_ATTEMPTS)
        .execute(&self.pool)
        .await?;
        let claim = sqlx::query_as(
            "WITH candidate AS (
                SELECT user_id FROM sync_wakeups WHERE attempts < $1 AND (
                    (status = 'pending' AND available_at <= now())
                    OR (status = 'running' AND lease_until <= now())
                ) ORDER BY available_at, user_id FOR UPDATE SKIP LOCKED LIMIT 1
             ) UPDATE sync_wakeups wakeup SET status = 'running', attempts = attempts + 1,
                 lease_token = $2, lease_until = now() + $3 * interval '1 second'
             FROM candidate WHERE wakeup.user_id = candidate.user_id
             RETURNING wakeup.user_id, wakeup.position, wakeup.lease_token",
        )
        .bind(MAX_ATTEMPTS)
        .bind(Uuid::new_v4())
        .bind(LEASE_SECONDS);

        Ok(claim.fetch_optional(&self.pool).await?)
    }

    /// Acknowledge only this lease, preserving positions committed while publication was in flight.
    pub async fn finish(
        &self,
        claim: &WakeupClaim,
        outcome: WakeupOutcome,
    ) -> Result<bool, AccountError> {
        let mut transaction = self.pool.begin().await?;
        let current = sqlx::query_scalar::<_, i64>(
            "SELECT position FROM sync_wakeups WHERE user_id = $1 AND lease_token = $2
             AND status = 'running' AND lease_until > now() FOR UPDATE",
        )
        .bind(claim.user_id)
        .bind(claim.lease_token);
        let Some(position) = current.fetch_optional(&mut *transaction).await? else {
            return Ok(false);
        };
        match outcome {
            WakeupOutcome::Published if position == claim.position => {
                sqlx::query("DELETE FROM sync_wakeups WHERE user_id = $1")
                    .bind(claim.user_id)
                    .execute(&mut *transaction)
                    .await?;
            }
            WakeupOutcome::Published => {
                sqlx::query(
                    "UPDATE sync_wakeups SET status = 'pending', attempts = 0,
                     lease_token = NULL, lease_until = NULL, last_error = NULL, available_at = now()
                     WHERE user_id = $1",
                )
                .bind(claim.user_id)
                .execute(&mut *transaction)
                .await?;
            }
            WakeupOutcome::Retry => {
                let retry = sqlx::query(
                    "UPDATE sync_wakeups SET status = CASE WHEN attempts >= $2
                         THEN 'exhausted' ELSE 'pending' END,
                     available_at = now() + ($3 * (1 << attempts) + random() * $3) * interval '1 second',
                     lease_token = NULL, lease_until = NULL, last_error = 'publication_unavailable'
                     WHERE user_id = $1",
                )
                .bind(claim.user_id)
                .bind(MAX_ATTEMPTS)
                .bind(RETRY_SECONDS);
                retry.execute(&mut *transaction).await?;
            }
        }
        transaction.commit().await?;

        Ok(true)
    }

    /// List bounded exhausted work without exposing message bodies or transport credentials.
    pub async fn exhausted(&self) -> Result<Vec<ExhaustedWakeup>, AccountError> {
        let query = sqlx::query_as(
            "SELECT user_id, position::text, attempts, last_error FROM sync_wakeups
             WHERE status = 'exhausted' ORDER BY updated_at, user_id LIMIT $1",
        )
        .bind(INSPECTION_LIMIT);

        Ok(query.fetch_all(&self.pool).await?)
    }

    /// Explicitly retry one exhausted account wakeup after an operator repairs its dependency.
    pub async fn retry(&self, user_id: Uuid) -> Result<bool, AccountError> {
        let update = sqlx::query(
            "UPDATE sync_wakeups SET status = 'pending', attempts = 0, available_at = now(),
             last_error = NULL WHERE user_id = $1 AND status = 'exhausted'",
        )
        .bind(user_id)
        .execute(&self.pool)
        .await?;

        Ok(update.rows_affected() == 1)
    }
}
