//! Bounded, encrypted mail intent with PostgreSQL leases and completion fencing.

pub mod link_previews;
mod mail;
pub mod maintenance;
mod payload;
mod settings;
pub mod wakeups;

use lettre::{AsyncSmtpTransport, Tokio1Executor, message::Mailbox};
use sqlx::{FromRow, PgConnection, PgPool};
use uuid::Uuid;

use crate::accounts::AccountError;
pub use payload::OutgoingMail;
use payload::{EncryptedMail, MailCipher};
pub use settings::MailSettings;

const MAX_PENDING_JOBS: i64 = 10000;
const MAX_ATTEMPTS: i32 = 5;
const LEASE_SECONDS: i64 = 60;
const RETRY_SECONDS: i64 = 10;

#[derive(Clone)]
pub struct MailQueue {
    pool: PgPool,
    pub(crate) origin: String,
    cipher: Option<MailCipher>,
    sender: Option<Mailbox>,
    transport: Option<AsyncSmtpTransport<Tokio1Executor>>,
}

#[derive(FromRow)]
pub struct MailClaim {
    pub id: Uuid,
    lease_token: Uuid,
}

pub enum DeliveryOutcome {
    Sent,
    Discarded,
    Retry,
}

#[derive(FromRow)]
struct StoredPayload {
    ciphertext: Vec<u8>,
    nonce: Vec<u8>,
}

pub(crate) struct MailIntent {
    pub challenge_id: Uuid,
    pub message: OutgoingMail,
}

impl MailQueue {
    /// Share the SMTP pool and encryption key across bounded mail operations.
    pub fn new(pool: PgPool, settings: MailSettings) -> Result<Self, AccountError> {
        let cipher = settings.key.as_ref().map(MailCipher::new).transpose()?;

        Ok(Self {
            pool,
            origin: settings.origin,
            cipher,
            sender: settings.sender,
            transport: settings.transport.map(|builder| builder.build::<Tokio1Executor>()),
        })
    }

    /// Advertise whether real SMTP delivery and protected queue storage are configured.
    pub fn is_enabled(&self) -> bool {
        self.transport.is_some()
    }

    /// Check queue capacity before identity lookup to prevent recovery enumeration.
    pub(crate) async fn reserve_capacity(
        &self,
        connection: &mut PgConnection,
    ) -> Result<(), AccountError> {
        if !self.is_enabled() {
            return Err(AccountError::EmailUnavailable);
        }
        sqlx::query("SELECT singleton FROM mail_queue_budget FOR UPDATE")
            .fetch_one(&mut *connection)
            .await?;
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM mail_jobs WHERE status IN ('pending', 'running')",
        )
        .fetch_one(connection)
        .await?;
        if count >= MAX_PENDING_JOBS {
            return Err(AccountError::QuotaExceeded);
        }

        Ok(())
    }

    /// Store encrypted mail in the same transaction that created its single-use challenge.
    pub(crate) async fn enqueue(
        &self,
        connection: &mut PgConnection,
        input: MailIntent,
    ) -> Result<(), AccountError> {
        let cipher = self.cipher.as_ref().ok_or(AccountError::EmailUnavailable)?;
        let id = Uuid::new_v4();
        let encrypted = cipher.encrypt(id, &input.message)?;
        let insert = sqlx::query(
            "INSERT INTO mail_jobs (id, challenge_id, ciphertext, nonce) VALUES ($1, $2, $3, $4)",
        )
        .bind(id)
        .bind(input.challenge_id);
        let insert = insert.bind(encrypted.ciphertext).bind(encrypted.nonce.as_slice());
        insert.execute(connection).await?;

        Ok(())
    }

    /// Claim one due job or expired lease without waiting behind another Worker.
    pub async fn claim(&self) -> Result<Option<MailClaim>, AccountError> {
        if !self.is_enabled() {
            return Ok(None);
        }
        // A crash during the final attempt must not create an unbounded sixth delivery attempt.
        sqlx::query(
            "UPDATE mail_jobs SET status = 'exhausted', finished_at = now(),
             lease_token = NULL, lease_until = NULL
             WHERE status = 'running' AND lease_until <= now() AND attempts >= $1",
        )
        .bind(MAX_ATTEMPTS)
        .execute(&self.pool)
        .await?;
        let claim = sqlx::query_as::<_, MailClaim>(
            "WITH candidate AS (
                SELECT id FROM mail_jobs
                WHERE attempts < $1 AND (
                    (status = 'pending' AND available_at <= now())
                    OR (status = 'running' AND lease_until <= now())
                ) ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1
             ) UPDATE mail_jobs SET status = 'running', attempts = attempts + 1,
               lease_token = $2, lease_until = now() + ($3::bigint * interval '1 second')
             FROM candidate WHERE mail_jobs.id = candidate.id
             RETURNING mail_jobs.id, mail_jobs.lease_token",
        )
        .bind(MAX_ATTEMPTS)
        .bind(Uuid::new_v4());

        claim.bind(LEASE_SECONDS).fetch_optional(&self.pool).await.map_err(Into::into)
    }

    /// Recheck the current lease and challenge immediately before exposing mail for delivery.
    pub async fn prepare(&self, claim: &MailClaim) -> Result<Option<OutgoingMail>, AccountError> {
        let stored = sqlx::query_as::<_, StoredPayload>(
            "SELECT jobs.ciphertext, jobs.nonce FROM mail_jobs AS jobs
             JOIN email_challenges AS challenge ON challenge.id = jobs.challenge_id
             JOIN users ON users.id = challenge.user_id
             WHERE jobs.id = $1 AND jobs.lease_token = $2
               AND jobs.status = 'running' AND jobs.lease_until > now()
               AND challenge.consumed_at IS NULL AND challenge.expires_at > now()
               AND challenge.credential_version = users.credential_version
               AND challenge.email_version = users.email_version AND NOT users.is_suspended
               AND (challenge.purpose <> 'recovery'
                    OR challenge.target_email = users.verified_email)",
        )
        .bind(claim.id)
        .bind(claim.lease_token);
        let Some(stored) = stored.fetch_optional(&self.pool).await? else {
            return Ok(None);
        };
        let cipher = self.cipher.as_ref().ok_or(AccountError::EmailUnavailable)?;
        let nonce = stored.nonce.try_into().map_err(|_| AccountError::Unavailable)?;
        let outgoing = cipher.decrypt(
            claim.id,
            EncryptedMail {
                ciphertext: stored.ciphertext,
                nonce,
            },
        )?;

        Ok(Some(outgoing))
    }

    /// Complete or reschedule only the lease still owned by this Worker and not yet expired.
    pub async fn finish(
        &self,
        claim: &MailClaim,
        outcome: DeliveryOutcome,
    ) -> Result<bool, AccountError> {
        let status = match outcome {
            DeliveryOutcome::Sent => "sent",
            DeliveryOutcome::Discarded => "discarded",
            DeliveryOutcome::Retry => "retry",
        };
        let update = sqlx::query(
            "UPDATE mail_jobs SET
                status = CASE WHEN $3 <> 'retry' THEN $3
                    WHEN attempts >= $4 THEN 'exhausted' ELSE 'pending' END,
                available_at = now() + (($5::bigint * (1 << attempts)) * interval '1 second'),
                finished_at = CASE WHEN $3 <> 'retry' OR attempts >= $4 THEN now() ELSE NULL END,
                ciphertext = CASE WHEN $3 IN ('sent', 'discarded')
                    THEN ''::bytea ELSE ciphertext END,
                lease_token = NULL, lease_until = NULL
             WHERE id = $1 AND lease_token = $2 AND status = 'running' AND lease_until > now()",
        )
        .bind(claim.id)
        .bind(claim.lease_token);
        let update = update.bind(status).bind(MAX_ATTEMPTS).bind(RETRY_SECONDS);

        Ok(update.execute(&self.pool).await?.rows_affected() == 1)
    }
}
