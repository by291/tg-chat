use sqlx::PgConnection;
use uuid::Uuid;

use super::{
    AccountError, AccountService, AccountSettings, Actor,
    credentials::{normalize_username, validate_text},
    email::EmailService,
    sessions,
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

pub(crate) struct Suspension {
    pub user_id: Uuid,
    pub status: UserStatus,
}

pub(crate) struct AuthorizedOperator {
    user_id: Uuid,
}

pub(crate) enum AuditActor {
    TrustedCli,
    Browser(Uuid),
}

pub(crate) enum AuditTarget {
    Registration,
    Account(Uuid),
    Case(Uuid),
    Conversation(Uuid),
    Job(Uuid),
}

pub(crate) enum AuditOutcome {
    Succeeded,
}

pub(crate) struct AuditEvent<'a> {
    pub actor: AuditActor,
    pub action: &'a str,
    pub target: AuditTarget,
    pub reason: &'a str,
    pub outcome: AuditOutcome,
}

impl AuthorizedOperator {
    /// Identify the browser operator whose current authority was checked.
    pub(crate) fn audit_actor(&self) -> AuditActor {
        AuditActor::Browser(self.user_id)
    }
}

/// Normalize and bound the reason shared by trusted and browser operator actions.
pub(crate) fn validate_reason(reason: &str) -> Result<String, AccountError> {
    validate_text(reason, REASON_LIMIT)
}

/// Lock the operator and any target in account order before locking the actor session.
pub(crate) async fn lock_operator_accounts(
    connection: &mut PgConnection,
    actor: &Actor,
    target_user_id: Option<Uuid>,
) -> Result<(), AccountError> {
    let lock = sqlx::query("SELECT id FROM users WHERE id = $1 OR id = $2 ORDER BY id FOR UPDATE")
        .bind(actor.user_id)
        .bind(target_user_id);
    lock.execute(connection).await?;

    Ok(())
}

/// Recheck the browser operator after acquiring locks that may delay the privileged action.
pub(crate) async fn authorize_operator(
    connection: &mut PgConnection,
    actor: &Actor,
    settings: &AccountSettings,
) -> Result<AuthorizedOperator, AccountError> {
    let (user, session) = sessions::lock_actor(connection, actor, settings).await?;
    if !user.is_operator {
        return Err(AccountError::Forbidden);
    }
    sessions::ensure_recent(&session, settings)?;

    Ok(AuthorizedOperator {
        user_id: user.id,
    })
}

/// Append a safe privileged-action record in the transaction that owns the action.
pub(crate) async fn append_audit(
    connection: &mut PgConnection,
    event: AuditEvent<'_>,
) -> Result<(), AccountError> {
    let (origin, actor_user_id) = match event.actor {
        AuditActor::TrustedCli => ("trusted_cli", None),
        AuditActor::Browser(user_id) => ("browser", Some(user_id)),
    };
    let (target_kind, target_id, target_user_id) = match event.target {
        AuditTarget::Registration => ("registration", None, None),
        AuditTarget::Account(user_id) => ("account", Some(user_id), Some(user_id)),
        AuditTarget::Case(case_id) => ("case", Some(case_id), None),
        AuditTarget::Conversation(conversation_id) => ("conversation", Some(conversation_id), None),
        AuditTarget::Job(job_id) => ("job", Some(job_id), None),
    };
    let outcome = match event.outcome {
        AuditOutcome::Succeeded => "succeeded",
    };

    let insert = sqlx::query(
        "INSERT INTO operator_audit (
             id, actor, actor_user_id, action, target_kind, target_id, target_user_id,
             reason, outcome
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(Uuid::new_v4())
    .bind(origin);
    let insert = insert.bind(actor_user_id).bind(event.action).bind(target_kind);
    let insert = insert.bind(target_id).bind(target_user_id).bind(event.reason);
    insert.bind(outcome).execute(connection).await?;

    Ok(())
}

/// Serialize a browser policy change with registration before checking recent authentication.
pub(crate) async fn lock_registration_policy(
    connection: &mut PgConnection,
) -> Result<(), AccountError> {
    sqlx::query("SELECT singleton FROM registration_policy WHERE singleton FOR UPDATE")
        .execute(connection)
        .await?;

    Ok(())
}

/// Apply the registration policy and return its audit action.
pub(crate) async fn apply_registration_policy(
    connection: &mut PgConnection,
    policy: RegistrationPolicy,
) -> Result<&'static str, AccountError> {
    let is_open = matches!(policy, RegistrationPolicy::Open);
    sqlx::query("UPDATE registration_policy SET is_open = $1 WHERE singleton")
        .bind(is_open)
        .execute(connection)
        .await?;

    if is_open {
        return Ok("registration_opened");
    }
    Ok("registration_closed")
}

/// Update suspension under the account lock and fence existing credentials and sessions.
pub(crate) async fn apply_suspension(
    connection: &mut PgConnection,
    suspension: Suspension,
) -> Result<&'static str, AccountError> {
    let is_suspended = matches!(suspension.status, UserStatus::Suspended);
    let update = sqlx::query(
        "UPDATE users SET is_suspended = $1,
             credential_version = credential_version + CASE WHEN $1 THEN 1 ELSE 0 END
         WHERE id = $2 AND deleted_at IS NULL",
    )
    .bind(is_suspended)
    .bind(suspension.user_id);
    let affected = update.execute(&mut *connection).await?.rows_affected();
    if affected == 0 {
        return Err(AccountError::NotFound);
    }
    if !is_suspended {
        return Ok("user_restored");
    }

    // Keep the revocation durable so the realtime worker can disconnect old clients
    // even if restoration commits before its next scan.
    sessions::revoke_all(connection, suspension.user_id).await?;
    EmailService::consume_challenges(connection, suspension.user_id).await?;

    Ok("user_suspended")
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
            AuditEvent {
                actor: AuditActor::TrustedCli,
                action: "operator_created",
                target: AuditTarget::Account(user_id),
                reason: "trusted bootstrap",
                outcome: AuditOutcome::Succeeded,
            },
        )
        .await?;
        transaction.commit().await?;

        Ok(user_id)
    }

    /// Serialize registration policy changes with account admission and record the reason.
    pub async fn set_registration_policy(&self, input: PolicyChange) -> Result<(), AccountError> {
        let reason = validate_reason(&input.reason)?;
        let mut transaction = self.pool.begin().await?;
        let action = apply_registration_policy(&mut transaction, input.policy).await?;
        append_audit(
            &mut transaction,
            AuditEvent {
                actor: AuditActor::TrustedCli,
                action,
                target: AuditTarget::Registration,
                reason: &reason,
                outcome: AuditOutcome::Succeeded,
            },
        )
        .await?;
        transaction.commit().await?;

        Ok(())
    }

    /// Suspend or restore an identity while keeping every previously revoked session invalid.
    pub async fn set_user_status(&self, input: SuspensionChange) -> Result<(), AccountError> {
        let username = normalize_username(&input.username)?;
        let reason = validate_reason(&input.reason)?;
        let mut transaction = self.pool.begin().await?;
        let target = sqlx::query_scalar("SELECT id FROM users WHERE username = $1 FOR UPDATE")
            .bind(username);
        let user_id =
            target.fetch_optional(&mut *transaction).await?.ok_or(AccountError::NotFound)?;
        let action = apply_suspension(
            &mut transaction,
            Suspension {
                user_id,
                status: input.status,
            },
        )
        .await?;
        append_audit(
            &mut transaction,
            AuditEvent {
                actor: AuditActor::TrustedCli,
                action,
                target: AuditTarget::Account(user_id),
                reason: &reason,
                outcome: AuditOutcome::Succeeded,
            },
        )
        .await?;
        transaction.commit().await?;

        Ok(())
    }
}
