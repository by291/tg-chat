//! Browser operator commands and transactional moderation.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgConnection;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::features::accounts::{
    AccountError, AccountService, Actor,
    operator::{
        AuditEvent, AuditOutcome, AuditTarget, EvidenceDeadlineChange, RegistrationPolicy,
        Suspension, UserStatus, append_audit, apply_registration_policy, apply_suspension,
        authorize_operator, lock_operator_accounts, lock_registration_policy, validate_reason,
    },
};

pub mod evidence;
pub(crate) mod http;
pub(crate) mod jobs;
pub(crate) mod quarantine;
pub(crate) mod quotas;
pub(crate) mod report_http;
pub mod reports;

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
    ResolveCase {
        case_id: Uuid,
    },
    ExtendEvidence {
        case_id: Uuid,
        deadline: DateTime<Utc>,
    },
    SetQuarantine {
        target: quarantine::QuarantineTarget,
        is_quarantined: bool,
    },
    SetAccountStorageLimit {
        user_id: Uuid,
        limit_bytes: Option<String>,
    },
    RetryJob {
        job_kind: jobs::OperatorJobKind,
        job_id: Uuid,
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
) -> Result<Option<quarantine::QuarantineScope>, AccountError> {
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
        OperatorAction::ResolveCase {
            ..
        }
        | OperatorAction::ExtendEvidence {
            ..
        }
        | OperatorAction::RetryJob {
            ..
        } => None,
        OperatorAction::SetQuarantine {
            target,
            ..
        } => {
            return quarantine::lock_scope(connection, actor, target).await.map(Some);
        }
        OperatorAction::SetAccountStorageLimit {
            user_id,
            ..
        } => Some(*user_id),
    };
    lock_operator_accounts(connection, actor, target).await?;

    Ok(None)
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
    scope: Option<quarantine::QuarantineScope>,
) -> Result<(AuditTarget, &'static str, Option<EvidenceDeadlineChange>), AccountError> {
    let (target, action) = match action {
        OperatorAction::SetRegistration {
            is_open,
        } => {
            let policy = if is_open {
                RegistrationPolicy::Open
            } else {
                RegistrationPolicy::Closed
            };
            let action = apply_registration_policy(connection, policy).await?;

            (AuditTarget::Registration, action)
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

            (AuditTarget::Account(user_id), action)
        }
        OperatorAction::ResolveCase {
            case_id,
        } => {
            evidence::resolve_case(connection, case_id).await?;

            (AuditTarget::Case(case_id), "case_resolved")
        }
        OperatorAction::ExtendEvidence {
            case_id,
            deadline,
        } => {
            let change = evidence::extend_evidence(connection, case_id, deadline).await?;

            return Ok((AuditTarget::Case(case_id), "evidence_extended", Some(change)));
        }
        OperatorAction::SetQuarantine {
            is_quarantined,
            ..
        } => {
            let scope = scope.ok_or(AccountError::Unavailable)?;
            let target = AuditTarget::Conversation(scope.conversation_id);
            quarantine::set(connection, scope, is_quarantined).await?;
            let action = if is_quarantined {
                "conversation_quarantined"
            } else {
                "conversation_restored"
            };

            (target, action)
        }
        OperatorAction::SetAccountStorageLimit {
            user_id,
            limit_bytes,
        } => {
            quotas::set_limit(connection, user_id, limit_bytes).await?;

            (AuditTarget::Account(user_id), "account_storage_limit_changed")
        }
        OperatorAction::RetryJob {
            job_kind,
            job_id,
        } => {
            jobs::retry(connection, job_kind, job_id).await?;

            (AuditTarget::Job(job_id), "exhausted_job_retried")
        }
    };

    Ok((target, action, None))
}

impl AccountService {
    /// Execute and audit one idempotent operator command after checking current authority.
    pub async fn submit_operator_command(
        &self,
        actor: &Actor,
        command: OperatorCommand,
    ) -> Result<(), AccountError> {
        // Reject ordinary accounts before they can inspect or lock a privileged target.
        let has_operator_role = sqlx::query_scalar::<_, bool>(
            "SELECT is_operator FROM users WHERE id = $1 AND NOT is_suspended",
        );
        let has_operator_role = has_operator_role.bind(actor.user_id).fetch_optional(&self.pool);
        if has_operator_role.await? != Some(true) {
            return Err(AccountError::Forbidden);
        }

        let reason = validate_reason(&command.reason)?;
        let encoded = serde_json::to_vec(&command).map_err(|_| AccountError::Unavailable)?;
        let payload_hash = Sha256::digest(encoded);
        let mut transaction = self.pool.begin().await?;

        let scope = lock_command_targets(&mut transaction, actor, &command.action).await?;
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

        let should_recheck = matches!(
            &command.action,
            OperatorAction::ResolveCase { .. }
                | OperatorAction::ExtendEvidence { .. }
                | OperatorAction::SetAccountStorageLimit { .. }
                | OperatorAction::RetryJob { .. }
        );
        let (target, action, details) =
            apply_action(&mut transaction, command.action, scope).await?;
        if should_recheck {
            // Case, quota, and retry actions may wait after taking the operator session lock.
            authorize_operator(&mut transaction, actor, &self.settings).await?;
        }
        append_audit(
            &mut transaction,
            AuditEvent {
                actor: operator.audit_actor(),
                action,
                target,
                reason: &reason,
                outcome: AuditOutcome::Succeeded,
                details,
            },
        )
        .await?;
        transaction.commit().await?;

        Ok(())
    }
}
