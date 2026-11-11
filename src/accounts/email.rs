use chrono::{DateTime, Utc};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgConnection};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{
    AccountError, AccountService, Actor,
    credentials::random_token,
    model::UserRecord,
    sessions::{ensure_recent, lock_actor},
};
use crate::jobs::{MailIntent, MailQueue, OutgoingMail};

const CHALLENGE_MINUTES: i64 = 15;
const TOKEN_LENGTH: usize = 43;
const MAX_EMAIL_BYTES: usize = 254;

#[derive(Clone)]
pub struct EmailService {
    accounts: AccountService,
    queue: MailQueue,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PasswordReset {
    pub token: String,
    pub new_password: String,
}

#[derive(FromRow)]
struct Challenge {
    id: Uuid,
    user_id: Uuid,
    purpose: String,
    target_email: String,
    credential_version: i64,
    email_version: i64,
    expires_at: DateTime<Utc>,
    consumed_at: Option<DateTime<Utc>>,
}

struct ChallengeIntent<'intent> {
    user: &'intent UserRecord,
    email: &'intent str,
    purpose: &'static str,
}

fn normalize_email(email: &str) -> Result<String, AccountError> {
    let email = email.trim().to_ascii_lowercase();
    if email.len() > MAX_EMAIL_BYTES || email.parse::<email_address::EmailAddress>().is_err() {
        return Err(AccountError::Validation("a valid email address is required"));
    }

    Ok(email)
}

fn challenge_hash(token: &str) -> Vec<u8> {
    let mut hash = Sha256::new();
    hash.update(b"tg-chat/email-challenge/");
    hash.update(token.as_bytes());

    hash.finalize().to_vec()
}

fn ensure_challenge(
    challenge: &Challenge,
    user: &UserRecord,
    purpose: &str,
) -> Result<(), AccountError> {
    let is_current = challenge.credential_version == user.credential_version
        && challenge.email_version == user.email_version;
    let is_available = challenge.consumed_at.is_none()
        && challenge.expires_at > Utc::now()
        && challenge.purpose == purpose;
    if !is_current || !is_available || user.is_suspended {
        return Err(AccountError::InvalidChallenge);
    }
    if purpose == "recovery" && user.verified_email.as_deref() != Some(&challenge.target_email) {
        return Err(AccountError::InvalidChallenge);
    }

    Ok(())
}

impl EmailService {
    /// Coordinate challenge transactions with the same account locks and durable mail queue.
    pub fn new(accounts: AccountService, queue: MailQueue) -> Self {
        Self {
            accounts,
            queue,
        }
    }

    /// Report whether new verification and recovery mail can actually be queued for SMTP.
    pub fn is_enabled(&self) -> bool {
        self.queue.is_enabled()
    }

    /// Queue verification without replacing the account's existing verified recovery address.
    pub async fn request_verification(
        &self,
        actor: &Actor,
        email: String,
    ) -> Result<(), AccountError> {
        let email = normalize_email(&email)?;
        let mut transaction = self.accounts.pool.begin().await?;
        // Queue admission always precedes user locks, including anonymous recovery admission.
        self.queue.reserve_capacity(&mut transaction).await?;
        let (user, session) = lock_actor(&mut transaction, actor, &self.accounts.settings).await?;
        ensure_recent(&session, &self.accounts.settings)?;
        self.create_challenge(
            &mut transaction,
            ChallengeIntent {
                user: &user,
                email: &email,
                purpose: "verification",
            },
        )
        .await?;
        transaction.commit().await?;

        Ok(())
    }

    /// Confirm one live link and replace the recovery address after ownership proof.
    pub async fn confirm(&self, token: String) -> Result<(), AccountError> {
        let snapshot = self.find_challenge(&token).await?;
        let mut transaction = self.accounts.pool.begin().await?;
        let user = self.lock_user(&mut transaction, snapshot.user_id).await?;
        let challenge = self.lock_challenge(&mut transaction, snapshot.id).await?;
        ensure_challenge(&challenge, &user, "verification")?;
        sqlx::query(
            "UPDATE users SET verified_email = $1, email_version = email_version + 1,
             profile_version = profile_version + 1 WHERE id = $2",
        )
        .bind(&challenge.target_email)
        .bind(user.id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            if error.as_database_error().is_some_and(|error| error.is_unique_violation()) {
                return AccountError::EmailUnavailableForAccount;
            }
            AccountError::Unavailable
        })?;
        Self::consume_challenges(&mut transaction, user.id).await?;
        transaction.commit().await?;

        Ok(())
    }

    /// Remove recovery ownership and invalidate pending links after recent password authentication.
    pub async fn remove(&self, actor: &Actor) -> Result<(), AccountError> {
        let mut transaction = self.accounts.pool.begin().await?;
        let (user, session) = lock_actor(&mut transaction, actor, &self.accounts.settings).await?;
        ensure_recent(&session, &self.accounts.settings)?;
        sqlx::query(
            "UPDATE users SET verified_email = NULL, email_version = email_version + 1,
             profile_version = profile_version + 1 WHERE id = $1",
        )
        .bind(user.id)
        .execute(&mut *transaction)
        .await?;
        Self::consume_challenges(&mut transaction, user.id).await?;
        transaction.commit().await?;

        Ok(())
    }

    /// Return the same admission result for unknown addresses and verified active identities.
    pub async fn request_recovery(&self, email: String) -> Result<(), AccountError> {
        let email = normalize_email(&email)?;
        let mut transaction = self.accounts.pool.begin().await?;
        self.queue.reserve_capacity(&mut transaction).await?;
        let query = sqlx::query_as::<_, UserRecord>(
            "SELECT * FROM users WHERE verified_email = $1 AND NOT is_suspended FOR UPDATE",
        )
        .bind(&email);
        let user = query.fetch_optional(&mut *transaction).await?;
        if let Some(user) = user {
            self.create_challenge(
                &mut transaction,
                ChallengeIntent {
                    user: &user,
                    email: &email,
                    purpose: "recovery",
                },
            )
            .await?;
        }
        transaction.commit().await?;

        Ok(())
    }

    /// Consume recovery once and revoke every session in the password-change transaction.
    pub async fn reset_password(&self, input: PasswordReset) -> Result<(), AccountError> {
        let snapshot = self.find_challenge(&input.token).await?;
        let password_hash = self.accounts.passwords.hash(input.new_password).await?;
        let mut transaction = self.accounts.pool.begin().await?;
        let user = self.lock_user(&mut transaction, snapshot.user_id).await?;
        let challenge = self.lock_challenge(&mut transaction, snapshot.id).await?;
        ensure_challenge(&challenge, &user, "recovery")?;
        sqlx::query(
            "UPDATE users SET password_hash = $1, credential_version = credential_version + 1
             WHERE id = $2",
        )
        .bind(password_hash)
        .bind(user.id)
        .execute(&mut *transaction)
        .await?;
        super::sessions::revoke_all(&mut transaction, user.id).await?;
        Self::consume_challenges(&mut transaction, user.id).await?;
        transaction.commit().await?;

        Ok(())
    }

    async fn find_challenge(&self, token: &str) -> Result<Challenge, AccountError> {
        if token.len() != TOKEN_LENGTH {
            return Err(AccountError::InvalidChallenge);
        }
        sqlx::query_as("SELECT * FROM email_challenges WHERE token_hash = $1")
            .bind(challenge_hash(token))
            .fetch_optional(&self.accounts.pool)
            .await?
            .ok_or(AccountError::InvalidChallenge)
    }

    async fn lock_user(
        &self,
        connection: &mut PgConnection,
        id: Uuid,
    ) -> Result<UserRecord, AccountError> {
        sqlx::query_as("SELECT * FROM users WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(connection)
            .await?
            .ok_or(AccountError::InvalidChallenge)
    }

    async fn lock_challenge(
        &self,
        connection: &mut PgConnection,
        id: Uuid,
    ) -> Result<Challenge, AccountError> {
        sqlx::query_as("SELECT * FROM email_challenges WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(connection)
            .await?
            .ok_or(AccountError::InvalidChallenge)
    }

    /// Invalidate all credential links while the caller owns the account lock.
    pub(crate) async fn consume_challenges(
        connection: &mut PgConnection,
        user_id: Uuid,
    ) -> Result<(), AccountError> {
        sqlx::query(
            "UPDATE email_challenges SET consumed_at = now()
             WHERE user_id = $1 AND consumed_at IS NULL",
        )
        .bind(user_id)
        .execute(connection)
        .await?;

        Ok(())
    }

    async fn create_challenge(
        &self,
        connection: &mut PgConnection,
        intent: ChallengeIntent<'_>,
    ) -> Result<(), AccountError> {
        let token = random_token()?;
        let id = Uuid::new_v4();
        sqlx::query(
            "UPDATE email_challenges SET consumed_at = now()
             WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL",
        )
        .bind(intent.user.id)
        .bind(intent.purpose)
        .execute(&mut *connection)
        .await?;
        let insert = sqlx::query(
            "INSERT INTO email_challenges (id, user_id, purpose, target_email, token_hash,
             credential_version, email_version, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8::bigint * interval '1 minute'))",
        )
        .bind(id)
        .bind(intent.user.id);
        let insert = insert.bind(intent.purpose).bind(intent.email).bind(challenge_hash(&token));
        let insert = insert.bind(intent.user.credential_version).bind(intent.user.email_version);
        insert.bind(CHALLENGE_MINUTES).execute(&mut *connection).await?;
        let (route, subject) = match intent.purpose {
            "verification" => ("verify-email", "Verify your TG Chat email"),
            _ => ("reset-password", "Reset your TG Chat password"),
        };
        let link = format!("{}/account/{route}#token={token}", self.queue.origin);
        let message = OutgoingMail {
            recipient: intent.email.to_owned(),
            subject: subject.to_owned(),
            body: format!(
                "Open this link within 15 minutes:\n{link}\n\nIf you did not request it, ignore this message."
            ),
        };
        self.queue
            .enqueue(
                connection,
                MailIntent {
                    challenge_id: id,
                    message,
                },
            )
            .await
    }
}
