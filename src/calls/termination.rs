use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use super::{
    model::{CallEndReason, CallPhase, CallRow},
    service::{LockCall, lock_call, publish_hint},
};
use crate::{accounts::AccountError, realtime::RealtimeClient};

const BATCH_SIZE: i64 = 8;

pub(crate) struct FinishCall {
    pub call_id: Uuid,
    pub reason: CallEndReason,
}

pub(crate) struct TerminationCheck<'a> {
    pub call: &'a CallRow,
    pub idle_days: i64,
}

pub(crate) struct TerminationBatch<'a> {
    pub pool: &'a PgPool,
    pub client: Option<&'a RealtimeClient>,
    pub idle_days: i64,
}

/// Commit the outcome, slots and both work items under the caller's canonical call locks.
pub(crate) async fn finish_call(
    connection: &mut PgConnection,
    input: FinishCall,
) -> Result<Option<CallRow>, AccountError> {
    let update = sqlx::query_as(
        "UPDATE calls SET phase = 'ended', revision = revision + 1,
             end_reason = $2, ended_at = clock_timestamp()
         WHERE id = $1 AND phase <> 'ended' RETURNING *",
    );
    let update = update.bind(input.call_id).bind(input.reason);
    let Some(call): Option<CallRow> = update.fetch_optional(&mut *connection).await? else {
        return Ok(None);
    };

    let release = sqlx::query("DELETE FROM call_slots WHERE call_id = $1");
    release.bind(call.id).execute(&mut *connection).await?;
    let cleanup = sqlx::query("INSERT INTO call_room_cleanup (call_id, revision) VALUES ($1, $2)");
    cleanup.bind(call.id).bind(call.revision).execute(&mut *connection).await?;
    let history = sqlx::query(
        "INSERT INTO call_history_work (call_id, revision, message_id) VALUES ($1, $2, $3)",
    );
    let history = history.bind(call.id).bind(call.revision).bind(Uuid::new_v4());
    history.execute(&mut *connection).await?;
    let remove = sqlx::query("DELETE FROM call_termination_intents WHERE call_id = $1");
    remove.bind(call.id).execute(connection).await?;

    Ok(Some(call))
}

/// Fence ringing and media access immediately, even before the Worker releases the slots.
pub(crate) async fn is_access_invalidated(
    connection: &mut PgConnection,
    input: TerminationCheck<'_>,
) -> Result<bool, AccountError> {
    let query = sqlx::query_scalar("SELECT call_access_invalidated($1, $2, clock_timestamp())");
    let query = query.bind(input.call.id).bind(input.idle_days);

    Ok(query.fetch_one(connection).await?)
}

/// Recheck designated sessions, durable policy changes, and deadlines using database time.
pub(crate) async fn termination_reason(
    connection: &mut PgConnection,
    input: TerminationCheck<'_>,
) -> Result<Option<CallEndReason>, AccountError> {
    if input.call.phase == CallPhase::Ended {
        return Ok(None);
    }

    let query = sqlx::query_as::<_, (bool, Option<bool>)>(
        "SELECT call_access_invalidated($1, $2, clock_timestamp()),
                $3 <= clock_timestamp()",
    );
    let query = query.bind(input.call.id).bind(input.idle_days);
    let query = query.bind(input.call.deadline());
    let (is_invalidated, is_expired): (bool, Option<bool>) = query.fetch_one(connection).await?;

    if is_invalidated {
        return Ok(Some(CallEndReason::AccessRevoked));
    }
    if is_expired == Some(true) {
        let reason = match input.call.phase {
            CallPhase::Ringing => CallEndReason::Missed,
            _ => CallEndReason::TransportFailed,
        };
        return Ok(Some(reason));
    }

    Ok(None)
}

async fn finish_due_call(batch: &TerminationBatch<'_>, call_id: Uuid) -> Result<(), AccountError> {
    let mut transaction = batch.pool.begin().await?;
    // Candidate selection is unlocked so policy writes never wait behind Worker lock acquisition.
    let call = lock_call(
        &mut transaction,
        LockCall {
            call_id,
            actor: None,
        },
    )
    .await?;
    let check = TerminationCheck {
        call: &call,
        idle_days: batch.idle_days,
    };
    let Some(reason) = termination_reason(&mut transaction, check).await? else {
        return Ok(());
    };
    let input = FinishCall {
        call_id,
        reason,
    };
    let ended = finish_call(&mut transaction, input).await?;
    transaction.commit().await?;
    if let Some(ended) = &ended {
        publish_hint(batch.client, ended).await;
    }

    Ok(())
}

/// Apply a bounded batch of policy invalidations and deadline expirations.
pub(crate) async fn terminate_due_calls(batch: TerminationBatch<'_>) -> Result<(), AccountError> {
    let query = sqlx::query_scalar(
        "SELECT call.id FROM call_slots slot JOIN calls call ON call.id = slot.call_id
         WHERE slot.user_id = call.caller_id AND call.phase <> 'ended'
           AND (call_access_invalidated(call.id, $1, now())
                OR (call.phase = 'ringing' AND call.ringing_deadline <= now())
                OR (call.phase = 'connecting' AND call.setup_deadline <= now())
                OR (call.phase = 'active' AND call.reconnect_deadline <= now()))
         ORDER BY call.created_at, call.id LIMIT $2",
    );
    let query = query.bind(batch.idle_days).bind(BATCH_SIZE);
    let candidates = query.fetch_all(batch.pool).await?;
    for call_id in candidates {
        finish_due_call(&batch, call_id).await?;
    }

    Ok(())
}
