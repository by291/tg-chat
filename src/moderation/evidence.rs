use chrono::{DateTime, TimeDelta, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgConnection, PgPool, QueryBuilder};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    accounts::{
        AccountError, AccountService, Actor,
        operator::{AuditEvent, AuditOutcome, AuditTarget, append_audit, authorize_operator},
    },
    media::references::{self, EvidenceAttachment},
};

const CASE_PAGE_SIZE: usize = 50;
const MAX_EXTENSION_DAYS: i64 = 90;

const CASE_SELECT: &str = "SELECT id, reporter_id, conversation_id, message_id, reported_author_id,
    reason, created_at, evidence_expires_at, resolved_at FROM moderation_cases";

#[derive(FromRow, Serialize, ToSchema)]
pub struct CaseSummary {
    id: Uuid,
    reporter_id: Uuid,
    conversation_id: Uuid,
    message_id: Uuid,
    reported_author_id: Uuid,
    reason: String,
    created_at: DateTime<Utc>,
    evidence_expires_at: DateTime<Utc>,
    resolved_at: Option<DateTime<Utc>>,
}

#[derive(Serialize, ToSchema)]
pub struct CasePage {
    items: Vec<CaseSummary>,
    next: Option<Uuid>,
}

#[derive(FromRow, Serialize, ToSchema)]
pub struct CaseEvidence {
    message_version: String,
    message_text: String,
    structured_body: Option<Value>,
    reporter_note: String,
}

#[derive(Serialize, ToSchema)]
pub struct CaseAttachment {
    occurrence_id: Uuid,
    file_name: String,
    size_bytes: i64,
}

#[derive(Serialize, ToSchema)]
pub struct CaseDetail {
    case: CaseSummary,
    evidence: Option<CaseEvidence>,
    attachments: Vec<CaseAttachment>,
}

pub(crate) struct AttachmentAccess {
    pub case_id: Uuid,
    pub occurrence_id: Uuid,
}

async fn lock_case(
    connection: &mut PgConnection,
    case_id: Uuid,
) -> Result<CaseSummary, AccountError> {
    let mut query = QueryBuilder::new(CASE_SELECT);
    query.push(" WHERE id = ").push_bind(case_id);
    query.push(" FOR UPDATE");
    let lock = query.build_query_as::<CaseSummary>();
    lock.fetch_optional(connection).await?.ok_or(AccountError::NotFound)
}

async fn current_evidence(
    connection: &mut PgConnection,
    case_id: Uuid,
) -> Result<Option<CaseEvidence>, AccountError> {
    let read = sqlx::query_as::<_, CaseEvidence>(
        "SELECT evidence.message_version::text, evidence.message_text,
             evidence.structured_body, evidence.reporter_note
         FROM moderation_evidence evidence JOIN moderation_cases report ON report.id = case_id
         WHERE case_id = $1 AND report.evidence_expires_at > clock_timestamp()",
    );
    Ok(read.bind(case_id).fetch_optional(connection).await?)
}

/// Mark a case resolved while preserving the original evidence deadline.
pub(crate) async fn resolve_case(
    connection: &mut PgConnection,
    case_id: Uuid,
) -> Result<(), AccountError> {
    lock_case(connection, case_id).await?;
    let update = sqlx::query(
        "UPDATE moderation_cases SET resolved_at = coalesce(resolved_at, clock_timestamp())
         WHERE id = $1",
    );
    update.bind(case_id).execute(connection).await?;

    Ok(())
}

/// Extend a still-active evidence deadline after obtaining the case lock.
pub(crate) async fn extend_evidence(
    connection: &mut PgConnection,
    case_id: Uuid,
    deadline: DateTime<Utc>,
) -> Result<(), AccountError> {
    let current = lock_case(connection, case_id).await?;
    let now: DateTime<Utc> =
        sqlx::query_scalar("SELECT clock_timestamp()").fetch_one(&mut *connection).await?;
    let can_extend = current.resolved_at.is_none()
        && current.evidence_expires_at > now
        && deadline > current.evidence_expires_at
        && deadline <= now + TimeDelta::days(MAX_EXTENSION_DAYS);
    if !can_extend {
        return Err(AccountError::Validation("invalid evidence extension"));
    }

    let update = sqlx::query("UPDATE moderation_cases SET evidence_expires_at = $2 WHERE id = $1");
    update.bind(case_id).bind(deadline).execute(connection).await?;

    Ok(())
}

/// Release one expired evidence snapshot and its references under the collection locks.
pub async fn expire_one(pool: &PgPool) -> Result<bool, AccountError> {
    let mut transaction = pool.begin().await?;
    let next = sqlx::query_scalar::<_, Uuid>(
        "SELECT report.id FROM moderation_cases report JOIN moderation_evidence evidence
         ON evidence.case_id = report.id WHERE report.evidence_expires_at <= clock_timestamp()
         ORDER BY report.evidence_expires_at, report.id LIMIT 1
         FOR UPDATE OF report SKIP LOCKED",
    );
    let Some(case_id) = next.fetch_optional(&mut *transaction).await? else {
        return Ok(false);
    };

    // Case locks order deadline extensions before reference release under ordered file locks.
    references::lock_evidence_files(&mut transaction, &[case_id]).await?;
    let delete = sqlx::query("DELETE FROM moderation_evidence WHERE case_id = $1");
    delete.bind(case_id).execute(&mut *transaction).await?;
    transaction.commit().await?;

    Ok(true)
}

impl AccountService {
    /// Read one bounded operator queue page in stable newest-first order.
    pub(crate) async fn report_cases(
        &self,
        actor: &Actor,
        after: Option<Uuid>,
    ) -> Result<CasePage, AccountError> {
        let mut transaction = self.pool.begin().await?;
        authorize_operator(&mut transaction, actor, &self.settings).await?;

        let mut query = QueryBuilder::new(CASE_SELECT);
        if let Some(after) = after {
            query.push(
                " WHERE (created_at, id) < (
                    SELECT created_at, id FROM moderation_cases WHERE id = ",
            );
            query.push_bind(after).push(")");
        }
        query.push(" ORDER BY created_at DESC, id DESC LIMIT ");
        query.push_bind((CASE_PAGE_SIZE + 1) as i64);
        let select = query.build_query_as::<CaseSummary>();
        let mut items = select.fetch_all(&mut *transaction).await?;
        transaction.commit().await?;

        let has_more = items.len() > CASE_PAGE_SIZE;
        items.truncate(CASE_PAGE_SIZE);
        let next = items.last().filter(|_| has_more).map(|item| item.id);

        Ok(CasePage {
            items,
            next,
        })
    }

    /// Read a case and audit access to its currently available evidence.
    pub(crate) async fn report_case(
        &self,
        actor: &Actor,
        case_id: Uuid,
    ) -> Result<CaseDetail, AccountError> {
        let mut transaction = self.pool.begin().await?;
        let operator = authorize_operator(&mut transaction, actor, &self.settings).await?;
        let case = lock_case(&mut transaction, case_id).await?;
        authorize_operator(&mut transaction, actor, &self.settings).await?;
        let evidence = current_evidence(&mut transaction, case_id).await?;

        let attachments = if evidence.is_some() {
            append_audit(
                &mut transaction,
                AuditEvent {
                    actor: operator.audit_actor(),
                    action: "report_evidence_viewed",
                    target: AuditTarget::Case(case_id),
                    reason: "Case review",
                    outcome: AuditOutcome::Succeeded,
                },
            )
            .await?;
            let files = references::evidence_attachments(&mut transaction, case_id).await?;
            files
                .into_iter()
                .map(|file| CaseAttachment {
                    occurrence_id: file.occurrence_id,
                    file_name: file.file_name,
                    size_bytes: file.size_bytes,
                })
                .collect()
        } else {
            Vec::new()
        };
        transaction.commit().await?;

        Ok(CaseDetail {
            case,
            evidence,
            attachments,
        })
    }

    /// Authorize and audit one original download through its unexpired case occurrence.
    pub(crate) async fn case_attachment(
        &self,
        actor: &Actor,
        input: AttachmentAccess,
    ) -> Result<EvidenceAttachment, AccountError> {
        let mut transaction = self.pool.begin().await?;
        let operator = authorize_operator(&mut transaction, actor, &self.settings).await?;
        lock_case(&mut transaction, input.case_id).await?;
        authorize_operator(&mut transaction, actor, &self.settings).await?;
        let live = sqlx::query_scalar::<_, bool>(
            "SELECT evidence_expires_at > clock_timestamp() FROM moderation_cases WHERE id = $1",
        );
        if !live.bind(input.case_id).fetch_one(&mut *transaction).await? {
            return Err(AccountError::NotFound);
        }

        let attachment =
            references::evidence_attachment(&mut transaction, input.case_id, input.occurrence_id)
                .await?
                .ok_or(AccountError::NotFound)?;
        append_audit(
            &mut transaction,
            AuditEvent {
                actor: operator.audit_actor(),
                action: "report_original_downloaded",
                target: AuditTarget::Case(input.case_id),
                reason: "Case review",
                outcome: AuditOutcome::Succeeded,
            },
        )
        .await?;
        transaction.commit().await?;

        Ok(attachment)
    }
}
