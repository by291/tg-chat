//! Verified LiveKit event receipts and room work scheduling.

use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::accounts::AccountError;

use super::{
    livekit::{LiveKit, VerifiedRoomEvent},
    model::CallPhase,
    reconciliation::MIN_PROBE_SECONDS,
};

pub(crate) struct ReceiveWebhook<'a> {
    pub pool: &'a PgPool,
    pub provider: &'a LiveKit,
    pub body: &'a str,
    pub token: &'a str,
}

#[derive(sqlx::FromRow)]
struct EventCall {
    id: Uuid,
    phase: CallPhase,
    revision: i64,
    provider_sid: Option<String>,
}

/// Verify the provider signature over the original body before scheduling room work.
pub(crate) async fn receive(input: ReceiveWebhook<'_>) -> Result<(), AccountError> {
    if let Some(event) = input.provider.verify_webhook(input.body, input.token)? {
        record_room_event(input.pool, &event).await?;
    }

    Ok(())
}

/// Record one event and coalesce its probe or cleanup request in the same transaction.
pub(crate) async fn record_room_event(
    pool: &PgPool,
    event: &VerifiedRoomEvent,
) -> Result<(), AccountError> {
    let mut transaction = pool.begin().await?;
    // Lock the call before room or cleanup work so termination and intake agree on the phase.
    let lookup = sqlx::query_as::<_, EventCall>(
        "SELECT call.id, call.phase, call.revision, room.provider_sid
         FROM call_rooms room JOIN calls call ON call.id = room.call_id
         WHERE room.room_name = $1 FOR UPDATE OF call",
    );
    let Some(call) = lookup.bind(&event.room).fetch_optional(&mut *transaction).await? else {
        return Ok(());
    };
    let matches_room = call.provider_sid.as_deref() == Some(event.sid.as_str());
    if !matches_room && call.phase != CallPhase::Ended {
        return Ok(());
    }

    let receipt = sqlx::query(
        "INSERT INTO call_webhook_receipts (event_id, call_id) VALUES ($1, $2)
         ON CONFLICT (event_id) DO NOTHING",
    );
    let receipt = receipt.bind(&event.id).bind(call.id);
    if receipt.execute(&mut *transaction).await?.rows_affected() == 0 {
        return Ok(());
    }

    if call.phase == CallPhase::Ended {
        schedule_cleanup(&mut transaction, &call).await?;
    } else {
        schedule_probe(&mut transaction, call.id).await?;
    }

    transaction.commit().await?;

    Ok(())
}

async fn schedule_cleanup(
    connection: &mut PgConnection,
    call: &EventCall,
) -> Result<(), AccountError> {
    // A deletion already in flight may predate the late activity. Fence its acknowledgement.
    let cleanup = sqlx::query(
        "INSERT INTO call_room_cleanup (call_id, revision) VALUES ($1, $2)
         ON CONFLICT (call_id) DO UPDATE
         SET available_at = clock_timestamp(), lease_id = NULL, lease_until = NULL",
    );
    cleanup.bind(call.id).bind(call.revision).execute(connection).await?;

    Ok(())
}

async fn schedule_probe(connection: &mut PgConnection, call_id: Uuid) -> Result<(), AccountError> {
    // Event order is unreliable. Use the hint only to advance the next permitted fresh probe.
    let schedule = sqlx::query(
        "UPDATE call_rooms SET probe_after = LEAST(
             probe_after, GREATEST(
                 clock_timestamp(), probe_started_at + make_interval(secs => $2)
             )
         ) WHERE call_id = $1",
    );
    schedule.bind(call_id).bind(MIN_PROBE_SECONDS).execute(connection).await?;

    Ok(())
}
