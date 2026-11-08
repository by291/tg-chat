use sqlx::PgConnection;
use uuid::Uuid;

use super::{
    AccountError, AccountService,
    credentials::{normalize_username, validate_text},
};

const REASON_LIMIT: usize = 500;
const DISPLAY_NAME_LIMIT: usize = 80;

pub struct OperatorCreation {
    pub username: String,
    pub password: String,
    pub display_name: String,
}

pub enum RegistrationPolicy {
    Open,
    Closed,
}

pub struct PolicyChange {
    pub policy: RegistrationPolicy,
    pub reason: String,
}

pub enum UserStatus {
    Active,
    Suspended,
}

pub struct SuspensionChange {
    pub username: String,
    pub status: UserStatus,
    pub reason: String,
}

struct AuditEntry<'entry> {
    action: &'entry str,
    user_id: Option<Uuid>,
    reason: &'entry str,
}

async fn append_audit(
    connection: &mut PgConnection,
    entry: AuditEntry<'_>,
) -> Result<(), AccountError> {
    let insert = sqlx::query(
        "INSERT INTO operator_audit (id, actor, action, target_user_id, reason)
         VALUES ($1, 'trusted_cli', $2, $3, $4)",
    )
    .bind(Uuid::new_v4())
    .bind(entry.action);
    let insert = insert.bind(entry.user_id).bind(entry.reason);
    insert.execute(connection).await?;

    Ok(())
}

impl AccountService {
    /// Bootstrap a privileged identity through trusted database access, without issuing a session.
    pub async fn create_operator(&self, input: OperatorCreation) -> Result<Uuid, AccountError> {
        let username = normalize_username(&input.username)?;
        let display_name = validate_text(&input.display_name, DISPLAY_NAME_LIMIT)?;
        let password_hash = self.passwords.hash(input.password).await?;
        let user_id = Uuid::new_v4();
        let mut transaction = self.pool.begin().await?;
        let insert = sqlx::query(
            "INSERT INTO users (id, username, password_hash, display_name, is_operator)
             VALUES ($1, $2, $3, $4, true)",
        )
        .bind(user_id)
        .bind(username);
        let insert = insert.bind(password_hash).bind(display_name);
        insert.execute(&mut *transaction).await.map_err(|error| {
            let is_duplicate =
                error.as_database_error().is_some_and(|error| error.is_unique_violation());
            if is_duplicate {
                return AccountError::UsernameUnavailable;
            }
            AccountError::Unavailable
        })?;
        append_audit(
            &mut transaction,
            AuditEntry {
                action: "operator_created",
                user_id: Some(user_id),
                reason: "trusted bootstrap",
            },
        )
        .await?;
        transaction.commit().await?;

        Ok(user_id)
    }

    /// Serialize registration policy changes with account admission and record the reason.
    pub async fn set_registration_policy(&self, input: PolicyChange) -> Result<(), AccountError> {
        let reason = validate_text(&input.reason, REASON_LIMIT)?;
        let is_open = matches!(input.policy, RegistrationPolicy::Open);
        let action = if is_open {
            "registration_opened"
        } else {
            "registration_closed"
        };
        let mut transaction = self.pool.begin().await?;
        sqlx::query("UPDATE registration_policy SET is_open = $1 WHERE singleton")
            .bind(is_open)
            .execute(&mut *transaction)
            .await?;
        append_audit(
            &mut transaction,
            AuditEntry {
                action,
                user_id: None,
                reason: &reason,
            },
        )
        .await?;
        transaction.commit().await?;

        Ok(())
    }

    /// Suspend or restore an identity while keeping every previously revoked session invalid.
    pub async fn set_user_status(&self, input: SuspensionChange) -> Result<(), AccountError> {
        let username = normalize_username(&input.username)?;
        let reason = validate_text(&input.reason, REASON_LIMIT)?;
        let is_suspended = matches!(input.status, UserStatus::Suspended);
        let action = if is_suspended {
            "user_suspended"
        } else {
            "user_restored"
        };
        let mut transaction = self.pool.begin().await?;
        let user_id: Uuid =
            sqlx::query_scalar("SELECT id FROM users WHERE username = $1 FOR UPDATE")
                .bind(username)
                .fetch_optional(&mut *transaction)
                .await?
                .ok_or(AccountError::NotFound)?;
        sqlx::query(
            "UPDATE users SET is_suspended = $1, credential_version = credential_version + 1
             WHERE id = $2",
        )
        .bind(is_suspended)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
        // Revocation survives restoration; suspension also fences in-flight credential admission.
        sqlx::query(
            "UPDATE sessions SET revoked_at = coalesce(revoked_at, now()) WHERE user_id = $1",
        )
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
        append_audit(
            &mut transaction,
            AuditEntry {
                action,
                user_id: Some(user_id),
                reason: &reason,
            },
        )
        .await?;
        transaction.commit().await?;

        Ok(())
    }
}
