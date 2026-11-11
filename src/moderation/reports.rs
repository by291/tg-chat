use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgConnection, QueryBuilder, types::Json};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    accounts::{AccountError, AccountService, Actor, sessions},
    media::references,
    messages::{
        CanonicalMessage, acceptance::MESSAGE_SELECT, bodies::MessageBodyView, forwarding, history,
        projection,
    },
};

const REPORTS_PER_HOUR: i64 = 10;
const NOTE_LIMIT: usize = 500;
const EVIDENCE_DAYS: i32 = 90;

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReportReason {
    Spam,
    Harassment,
    HarmfulContent,
    Other,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReportMessage {
    operation_id: Uuid,
    reason: ReportReason,
    note: Option<String>,
}

#[derive(FromRow, Serialize, ToSchema)]
pub struct ReportReceipt {
    pub case_id: Uuid,
    pub evidence_expires_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct StoredReceipt {
    case_id: Uuid,
    evidence_expires_at: DateTime<Utc>,
    payload_hash: Vec<u8>,
}

struct ReportAdmission<'a> {
    actor: &'a Actor,
    source: Uuid,
    report: &'a ReportMessage,
    fingerprint: &'a [u8],
}

struct CaseInsert<'a> {
    message: &'a CanonicalMessage,
    reporter_id: Uuid,
    reason: ReportReason,
    note: &'a str,
}

fn snapshot_body(
    body: Option<MessageBodyView>,
) -> Result<Option<Json<serde_json::Value>>, AccountError> {
    let description = match &body {
        Some(MessageBodyView::Poll(poll)) => poll.description.clone(),
        _ => None,
    };
    let Some(snapshot) = forwarding::snapshot_body(body) else {
        return Ok(None);
    };
    let mut evidence = serde_json::to_value(snapshot).map_err(|_| AccountError::Unavailable)?;
    if let Some(description) = description {
        // The review needs visible poll text even though forwarding drops the description.
        let fields = evidence.as_object_mut().ok_or(AccountError::Unavailable)?;
        fields.insert("description".to_owned(), serde_json::Value::String(description));
    }

    Ok(Some(Json(evidence)))
}

impl ReportReason {
    fn database_name(self) -> &'static str {
        match self {
            Self::Spam => "spam",
            Self::Harassment => "harassment",
            Self::HarmfulContent => "harmful_content",
            Self::Other => "other",
        }
    }
}

async fn lock_source_conversation(
    connection: &mut PgConnection,
    message_id: Uuid,
) -> Result<(), AccountError> {
    // Message removal and forwarding take the conversation before accounts and file references.
    let lock = sqlx::query(
        "SELECT conversation.id FROM conversations conversation JOIN messages message
         ON message.conversation_id = conversation.id WHERE message.id = $1
         FOR UPDATE OF conversation",
    );
    lock.bind(message_id).fetch_optional(connection).await?;

    Ok(())
}

async fn existing_receipt(
    connection: &mut PgConnection,
    admission: &ReportAdmission<'_>,
) -> Result<Option<ReportReceipt>, AccountError> {
    let lookup = sqlx::query_as::<_, StoredReceipt>(
        "SELECT receipt.case_id, receipt.payload_hash,
             report.created_at + make_interval(hours => $3) AS evidence_expires_at
         FROM moderation_report_receipts receipt JOIN moderation_cases report
         ON report.id = receipt.case_id WHERE receipt.reporter_id = $1
         AND receipt.operation_id = $2",
    );
    let lookup = lookup.bind(admission.actor.user_id).bind(admission.report.operation_id);
    let lookup = lookup.bind(EVIDENCE_DAYS * 24);
    let Some(receipt) = lookup.fetch_optional(connection).await? else {
        return Ok(None);
    };
    if receipt.payload_hash != admission.fingerprint {
        return Err(AccountError::MessageConflict);
    }

    Ok(Some(ReportReceipt {
        case_id: receipt.case_id,
        evidence_expires_at: receipt.evidence_expires_at,
    }))
}

async fn store_receipt(
    connection: &mut PgConnection,
    admission: &ReportAdmission<'_>,
    receipt: &ReportReceipt,
) -> Result<(), AccountError> {
    let insert = sqlx::query(
        "INSERT INTO moderation_report_receipts (reporter_id, operation_id, case_id, payload_hash)
         VALUES ($1, $2, $3, $4)",
    );
    let insert = insert.bind(admission.actor.user_id).bind(admission.report.operation_id);
    let insert = insert.bind(receipt.case_id).bind(admission.fingerprint);
    insert.execute(connection).await?;

    Ok(())
}

async fn existing_case(
    connection: &mut PgConnection,
    admission: &ReportAdmission<'_>,
) -> Result<Option<ReportReceipt>, AccountError> {
    let lookup = sqlx::query_as::<_, ReportReceipt>(
        "SELECT id AS case_id, created_at + make_interval(hours => $3) AS evidence_expires_at
         FROM moderation_cases
         WHERE reporter_id = $1 AND message_id = $2",
    );
    let lookup = lookup.bind(admission.actor.user_id).bind(admission.source);
    let lookup = lookup.bind(EVIDENCE_DAYS * 24);
    Ok(lookup.fetch_optional(connection).await?)
}

async fn report_source(
    connection: &mut PgConnection,
    admission: &ReportAdmission<'_>,
) -> Result<CanonicalMessage, AccountError> {
    let mut query = QueryBuilder::new(MESSAGE_SELECT);
    query.push(" WHERE message.id = ").push_bind(admission.source);
    projection::restrict_visible(&mut query, admission.actor.user_id);
    query.push(" AND (message.expires_at IS NULL OR message.expires_at > clock_timestamp())");
    let found = query.build_query_as::<CanonicalMessage>().fetch_optional(&mut *connection);
    let mut message = found.await?.ok_or(AccountError::NotFound)?;
    projection::personalize(connection, admission.actor.user_id, &mut message).await?;

    Ok(message)
}

async fn check_report_budget(
    connection: &mut PgConnection,
    reporter_id: Uuid,
) -> Result<(), AccountError> {
    // The reporter's account lock serializes admission across concurrent conversations.
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM moderation_cases WHERE reporter_id = $1
         AND created_at > clock_timestamp() - interval '1 hour'",
    );
    let count = count.bind(reporter_id).fetch_one(connection).await?;
    if count >= REPORTS_PER_HOUR {
        return Err(AccountError::RateLimited);
    }

    Ok(())
}

async fn insert_case(
    connection: &mut PgConnection,
    input: CaseInsert<'_>,
) -> Result<ReportReceipt, AccountError> {
    let insert = sqlx::query_as::<_, ReportReceipt>(
        "WITH accepted AS (SELECT clock_timestamp() AS created_at)
         INSERT INTO moderation_cases (
             id, reporter_id, conversation_id, message_id, reported_author_id, reason,
             created_at, evidence_expires_at
         )
         SELECT $1, $2, $3, $4, $5, $6, accepted.created_at,
             accepted.created_at + make_interval(hours => $7)
         FROM accepted RETURNING id AS case_id, evidence_expires_at",
    );
    let insert = insert.bind(Uuid::new_v4()).bind(input.reporter_id);
    let insert = insert.bind(input.message.conversation_id).bind(input.message.id);
    let insert = insert.bind(input.message.author_id).bind(input.reason.database_name());
    let receipt = insert.bind(EVIDENCE_DAYS * 24).fetch_one(&mut *connection).await?;

    let version = history::parse_sequence(&input.message.version)?;
    let body = snapshot_body(input.message.body.clone())?;
    let insert = sqlx::query(
        "INSERT INTO moderation_evidence (
             case_id, message_version, message_text, structured_body, reporter_note
         ) VALUES ($1, $2, $3, $4, $5)",
    );
    let insert = insert.bind(receipt.case_id).bind(version).bind(&input.message.content.text);
    let insert = insert.bind(body).bind(input.note);
    insert.execute(&mut *connection).await?;

    references::copy_evidence_references(connection, input.message.id, receipt.case_id).await?;

    // A file lock can outlast the source's visible lifetime, even under the conversation lock.
    if let Some(deadline) = input.message.expires_at {
        let is_expired = sqlx::query_scalar::<_, bool>("SELECT $1 <= clock_timestamp()");
        if is_expired.bind(deadline).fetch_one(connection).await? {
            return Err(AccountError::NotFound);
        }
    }

    Ok(receipt)
}

impl AccountService {
    /// Capture one currently visible message and bind its case to the reporter's operation.
    pub async fn report_message(
        &self,
        actor: Actor,
        source: Uuid,
        mut report: ReportMessage,
    ) -> Result<ReportReceipt, AccountError> {
        report.note = report.note.map(|note| note.trim().to_owned());
        let note = report.note.as_deref().unwrap_or_default();
        if note.encode_utf16().count() > NOTE_LIMIT {
            return Err(AccountError::Validation("report note is too long"));
        }
        let payload =
            serde_json::to_vec(&(source, &report)).map_err(|_| AccountError::Unavailable)?;
        let fingerprint = Sha256::digest(payload);
        let admission = ReportAdmission {
            actor: &actor,
            source,
            report: &report,
            fingerprint: &fingerprint,
        };

        let mut transaction = self.pool.begin().await?;
        lock_source_conversation(&mut transaction, source).await?;
        sessions::lock_actor(&mut transaction, &actor, &self.settings).await?;
        if let Some(receipt) = existing_receipt(&mut transaction, &admission).await? {
            transaction.commit().await?;
            return Ok(receipt);
        }

        // Repeated reports return the existing case without creating unbounded alias receipts.
        if let Some(receipt) = existing_case(&mut transaction, &admission).await? {
            transaction.commit().await?;
            return Ok(receipt);
        }

        let message = report_source(&mut transaction, &admission).await?;
        check_report_budget(&mut transaction, actor.user_id).await?;
        let input = CaseInsert {
            message: &message,
            reporter_id: actor.user_id,
            reason: report.reason,
            note,
        };
        let receipt = insert_case(&mut transaction, input).await?;
        store_receipt(&mut transaction, &admission, &receipt).await?;
        transaction.commit().await?;

        Ok(receipt)
    }
}
