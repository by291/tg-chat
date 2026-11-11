//! Browser operator commands and transactional moderation.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgConnection;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::accounts::{
    AccountError, AccountService, Actor,
    operator::{
        AuditEvent, AuditOutcome, AuditTarget, RegistrationPolicy, Suspension, UserStatus,
        append_audit, apply_registration_policy, apply_suspension, authorize_operator,
        lock_operator_accounts, lock_registration_policy, validate_reason,
    },
};

pub(crate) mod http;

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OperatorCommand {
    pub operation_id: Uuid,
    pub reason: String,
    pub action: OperatorAction,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum OperatorAction {
    SetRegistration {
        is_open: bool,
    },
    SetSuspension {
        user_id: Uuid,
        is_suspended: bool,
    },
}

struct OperatorReceipt<'a> {
    actor_user_id: Uuid,
    operation_id: Uuid,
    payload_hash: &'a [u8],
}

async fn lock_command_targets(
    connection: &mut PgConnection,
    actor: &Actor,
    action: &OperatorAction,
) -> Result<(), AccountError> {
    let target = match action {
        OperatorAction::SetRegistration {
            ..
        } => {
            lock_registration_policy(connection).await?;
            None
        }
        OperatorAction::SetSuspension {
            user_id,
            ..
        } => Some(*user_id),
    };
    lock_operator_accounts(connection, actor, target).await
}

async fn is_replayed(
    connection: &mut PgConnection,
    receipt: OperatorReceipt<'_>,
) -> Result<bool, AccountError> {
    // All commands from this identity hold the same actor row before reserving a receipt.
    let query = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT payload_hash FROM operator_command_receipts
         WHERE actor_user_id = $1 AND operation_id = $2",
    )
    .bind(receipt.actor_user_id)
    .bind(receipt.operation_id);
    let existing = query.fetch_optional(&mut *connection).await?;
    if let Some(existing) = existing {
        if existing == receipt.payload_hash {
            return Ok(true);
        }
        return Err(AccountError::OperationConflict);
    }

    let insert = sqlx::query(
        "INSERT INTO operator_command_receipts (actor_user_id, operation_id, payload_hash)
         VALUES ($1, $2, $3)",
    )
    .bind(receipt.actor_user_id)
    .bind(receipt.operation_id)
    .bind(receipt.payload_hash);
    insert.execute(connection).await?;

    Ok(false)
}

async fn apply_action(
    connection: &mut PgConnection,
    action: OperatorAction,
) -> Result<(AuditTarget, &'static str), AccountError> {
    match action {
        OperatorAction::SetRegistration {
            is_open,
        } => {
            let policy = if is_open {
                RegistrationPolicy::Open
            } else {
                RegistrationPolicy::Closed
            };
            let action = apply_registration_policy(connection, policy).await?;

            Ok((AuditTarget::Registration, action))
        }
        OperatorAction::SetSuspension {
            user_id,
            is_suspended,
        } => {
            let status = if is_suspended {
                UserStatus::Suspended
            } else {
                UserStatus::Active
            };
            let action = apply_suspension(
                connection,
                Suspension {
                    user_id,
                    status,
                },
            )
            .await?;

            Ok((AuditTarget::Account(user_id), action))
        }
    }
}

impl AccountService {
    /// Execute and audit one idempotent operator command after checking current authority.
    pub async fn submit_operator_command(
        &self,
        actor: &Actor,
        command: OperatorCommand,
    ) -> Result<(), AccountError> {
        let reason = validate_reason(&command.reason)?;
        let encoded = serde_json::to_vec(&command).map_err(|_| AccountError::Unavailable)?;
        let payload_hash = Sha256::digest(encoded);
        let mut transaction = self.pool.begin().await?;

        lock_command_targets(&mut transaction, actor, &command.action).await?;
        let operator = authorize_operator(&mut transaction, actor, &self.settings).await?;
        let receipt = OperatorReceipt {
            actor_user_id: actor.user_id,
            operation_id: command.operation_id,
            payload_hash: payload_hash.as_slice(),
        };
        if is_replayed(&mut transaction, receipt).await? {
            transaction.commit().await?;
            return Ok(());
        }

        let (target, action) = apply_action(&mut transaction, command.action).await?;
        append_audit(
            &mut transaction,
            AuditEvent {
                actor: operator.audit_actor(),
                action,
                target,
                reason: &reason,
                outcome: AuditOutcome::Succeeded,
            },
        )
        .await?;
        transaction.commit().await?;

        Ok(())
    }
}
