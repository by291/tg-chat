use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use super::model::{CallEndReason, CallMode};
use crate::{accounts::AccountError, messages::acceptance::write_call_record};

const HISTORY_RETRY_SECONDS: i64 = 2;
const SECONDS_PER_MINUTE: i64 = 60;

#[derive(FromRow)]
pub(crate) struct CallRecord {
    pub call_id: Uuid,
    pub message_id: Uuid,
    pub conversation_id: Uuid,
    pub caller_id: Uuid,
    pub mode: CallMode,
    pub end_reason: CallEndReason,
    pub active_at: Option<DateTime<Utc>>,
    pub ended_at: DateTime<Utc>,
}

impl CallRecord {
    /// Format the call type, outcome, and any established media duration for chat history.
    pub(crate) fn summary(&self) -> String {
        let mode = match self.mode {
            CallMode::Voice => "Voice call",
            CallMode::Video => "Video call",
        };
        let outcome = match self.end_reason {
            CallEndReason::Declined => "declined",
            CallEndReason::Cancelled => "cancelled",
            CallEndReason::Missed => "missed",
            CallEndReason::Completed => "completed",
            CallEndReason::PermissionDenied => "media permission denied",
            CallEndReason::TransportFailed => "connection failed",
            CallEndReason::AccessRevoked => "access revoked",
        };
        let Some(active_at) = self.active_at else {
            return format!("{mode} · {outcome}");
        };

        let seconds = (self.ended_at - active_at).num_seconds().max(0);
        let minutes = seconds / SECONDS_PER_MINUTE;
        let seconds = seconds % SECONDS_PER_MINUTE;

        format!("{mode} · {outcome} · {minutes}:{seconds:02}")
    }
}

/// Publish one terminal event atomically with its durable acknowledgement.
pub(crate) async fn publish_one(pool: &PgPool) -> Result<bool, AccountError> {
    let mut transaction = pool.begin().await?;
    let select = sqlx::query_as(
        "SELECT work.call_id, work.message_id, call.conversation_id, call.caller_id,
                call.mode, call.end_reason, call.active_at, call.ended_at
         FROM call_history_work work JOIN calls call ON call.id = work.call_id
         WHERE work.published_at IS NULL AND work.available_at <= now()
           AND call.phase = 'ended' AND call.revision = work.revision
         ORDER BY work.available_at, work.call_id LIMIT 1 FOR UPDATE OF work SKIP LOCKED",
    );
    let Some(record): Option<CallRecord> = select.fetch_optional(&mut *transaction).await? else {
        return Ok(false);
    };

    if let Err(error) = write_call_record(&mut transaction, &record).await {
        transaction.rollback().await?;
        // Move a failed job behind other due records once its message transaction rolls back.
        let delay = sqlx::query(
            "UPDATE call_history_work SET available_at = now() + $2 * interval '1 second'
             WHERE call_id = $1 AND published_at IS NULL",
        );
        let delay = delay.bind(record.call_id).bind(HISTORY_RETRY_SECONDS);
        delay.execute(pool).await?;

        return Err(error);
    }

    let acknowledge = sqlx::query(
        "UPDATE call_history_work SET published_at = clock_timestamp() WHERE call_id = $1",
    );
    acknowledge.bind(record.call_id).execute(&mut *transaction).await?;
    transaction.commit().await?;

    Ok(true)
}
