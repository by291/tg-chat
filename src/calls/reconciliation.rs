//! Reconcile application call state with leased LiveKit room observations.

use std::time::Duration;

use futures_util::future::join_all;
use sqlx::{FromRow, PgConnection, PgPool};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{accounts::AccountError, realtime::RealtimeClient};

use super::{
    livekit::{LiveKit, RoomSnapshot},
    model::{CallPhase, CallRow},
    service::{LockCall, database_now, lock_call, publish_hint},
    termination::{FinishCall, TerminationCheck, finish_call, termination_reason},
};

pub(crate) const MIN_PROBE_SECONDS: i32 = 5;
const FALLBACK_PROBE_SECONDS: i32 = 6;
const PROBE_LEASE_SECONDS: i32 = 15;
const PROBE_BATCH_SIZE: i64 = 4;
const RECONNECT_SECONDS: i32 = 30;
const POLL_INTERVAL: Duration = Duration::from_millis(500);

pub(crate) struct ReconciliationSettings {
    pub pool: PgPool,
    pub provider: LiveKit,
    pub realtime: Option<RealtimeClient>,
    pub idle_days: i64,
}

pub(crate) struct Reconciliation {
    settings: ReconciliationSettings,
}

#[derive(FromRow)]
struct ProbeClaim {
    call_id: Uuid,
    room_name: String,
    provider_sid: String,
    caller_identity: Uuid,
    recipient_identity: Uuid,
    probe_lease_id: Uuid,
}

enum MediaState {
    Connected,
    Disconnected,
}

struct RoomObservation {
    claim: ProbeClaim,
    media: MediaState,
    idle_days: i64,
}

impl Reconciliation {
    /// Configure background room probes and their application policy.
    pub(crate) fn new(settings: ReconciliationSettings) -> Self {
        Self {
            settings,
        }
    }

    /// Reconcile ready rooms until the Worker shuts down.
    pub(crate) async fn run(&self, stop: CancellationToken) {
        loop {
            let result = tokio::select! {
                () = stop.cancelled() => return,
                result = self.process() => result,
            };
            match result {
                Ok(true) => continue,
                Ok(false) => {}
                Err(_) => tracing::warn!("call_room_reconciliation_unavailable"),
            }

            tokio::select! {
                () = stop.cancelled() => return,
                () = tokio::time::sleep(POLL_INTERVAL) => {}
            }
        }
    }

    async fn process(&self) -> Result<bool, AccountError> {
        let claims = claim_probes(&self.settings.pool).await?;
        if claims.is_empty() {
            return Ok(false);
        }

        // Keep a failed provider request from blocking probes for other rooms in the batch.
        let results = join_all(claims.into_iter().map(|claim| self.process_probe(claim))).await;
        for result in results {
            result?;
        }

        Ok(true)
    }

    async fn process_probe(&self, claim: ProbeClaim) -> Result<(), AccountError> {
        let snapshot = self.settings.provider.inspect(&claim.room_name).await;
        let observation = RoomObservation {
            media: media_state(&claim, snapshot),
            idle_days: self.settings.idle_days,
            claim,
        };
        let mut transaction = self.settings.pool.begin().await?;
        let changed = apply_room_observation(&mut transaction, observation).await?;
        transaction.commit().await?;

        if let Some(call) = &changed {
            publish_hint(self.settings.realtime.as_ref(), call).await;
        }

        Ok(())
    }
}

async fn claim_probes(pool: &PgPool) -> Result<Vec<ProbeClaim>, AccountError> {
    let claim = sqlx::query_as(
        "WITH candidate AS (
             SELECT room.call_id FROM call_rooms room JOIN calls call ON call.id = room.call_id
             WHERE call.phase IN ('connecting', 'active')
               AND room.provider_sid IS NOT NULL AND room.probe_after <= clock_timestamp()
               AND (room.probe_lease_until IS NULL OR room.probe_lease_until <= clock_timestamp())
             ORDER BY room.probe_after, room.call_id LIMIT $1 FOR UPDATE OF room SKIP LOCKED
         )
         UPDATE call_rooms room SET probe_lease_id = gen_random_uuid(),
             probe_lease_until = clock_timestamp() + make_interval(secs => $2),
             probe_started_at = clock_timestamp(),
             probe_after = clock_timestamp() + make_interval(secs => $3)
         FROM candidate WHERE room.call_id = candidate.call_id
         RETURNING room.call_id, room.room_name, room.provider_sid,
                   room.caller_identity, room.recipient_identity, room.probe_lease_id",
    );
    let claim = claim.bind(PROBE_BATCH_SIZE).bind(PROBE_LEASE_SECONDS).bind(FALLBACK_PROBE_SECONDS);

    Ok(claim.fetch_all(pool).await?)
}

fn media_state(
    claim: &ProbeClaim,
    snapshot: Result<Option<RoomSnapshot>, AccountError>,
) -> MediaState {
    // An unreachable provider cannot confirm media and must start the same bounded grace period.
    let Ok(Some(snapshot)) = snapshot else {
        return MediaState::Disconnected;
    };

    let is_connected = snapshot.sid == claim.provider_sid
        && snapshot.connected_participants.contains(&claim.caller_identity)
        && snapshot.connected_participants.contains(&claim.recipient_identity);
    if is_connected {
        return MediaState::Connected;
    }

    MediaState::Disconnected
}

async fn release_probe(
    connection: &mut PgConnection,
    claim: &ProbeClaim,
) -> Result<bool, AccountError> {
    // A restarted Worker can replace the lease while an older provider request is in flight.
    let release = sqlx::query(
        "UPDATE call_rooms SET probe_lease_id = NULL, probe_lease_until = NULL
         WHERE call_id = $1 AND probe_lease_id = $2 AND probe_lease_until > clock_timestamp()
           AND room_name = $3 AND provider_sid = $4
           AND caller_identity = $5 AND recipient_identity = $6",
    );
    let release = release.bind(claim.call_id).bind(claim.probe_lease_id).bind(&claim.room_name);
    let release = release.bind(&claim.provider_sid);
    let release = release.bind(claim.caller_identity).bind(claim.recipient_identity);

    Ok(release.execute(connection).await?.rows_affected() > 0)
}

async fn apply_room_observation(
    connection: &mut PgConnection,
    observation: RoomObservation,
) -> Result<Option<CallRow>, AccountError> {
    let call_id = observation.claim.call_id;
    let call = lock_call(
        connection,
        LockCall {
            call_id,
            actor: None,
        },
    )
    .await?;
    if !release_probe(connection, &observation.claim).await? {
        return Ok(None);
    }
    if !matches!(call.phase, CallPhase::Connecting | CallPhase::Active) {
        return Ok(None);
    }

    // Policy and elapsed deadlines take precedence over a provider success.
    let check = TerminationCheck {
        call: &call,
        idle_days: observation.idle_days,
    };
    if let Some(reason) = termination_reason(connection, check).await? {
        return finish_call(
            connection,
            FinishCall {
                call_id,
                reason,
            },
        )
        .await;
    }

    match (call.phase, observation.media, call.reconnect_deadline) {
        (CallPhase::Connecting, MediaState::Connected, _) => activate(connection, call.id).await,
        (CallPhase::Active, MediaState::Connected, Some(_)) => {
            clear_reconnect(connection, call.id).await
        }
        (CallPhase::Active, MediaState::Disconnected, None) => {
            start_reconnect(connection, call.id).await
        }
        _ => Ok(None),
    }
}

async fn activate(
    connection: &mut PgConnection,
    call_id: Uuid,
) -> Result<Option<CallRow>, AccountError> {
    let update = sqlx::query_as(
        "UPDATE calls SET phase = 'active', active_at = clock_timestamp(), revision = revision + 1
         WHERE id = $1 RETURNING *",
    );

    Ok(update.bind(call_id).fetch_optional(connection).await?)
}

async fn start_reconnect(
    connection: &mut PgConnection,
    call_id: Uuid,
) -> Result<Option<CallRow>, AccountError> {
    let now = database_now(connection).await?;
    let deadline = now + chrono::TimeDelta::seconds(i64::from(RECONNECT_SECONDS));
    let update = sqlx::query_as(
        "UPDATE calls SET reconnect_deadline = $2, revision = revision + 1
         WHERE id = $1 RETURNING *",
    );
    let update = update.bind(call_id).bind(deadline);

    Ok(update.fetch_optional(connection).await?)
}

async fn clear_reconnect(
    connection: &mut PgConnection,
    call_id: Uuid,
) -> Result<Option<CallRow>, AccountError> {
    let update = sqlx::query_as(
        "UPDATE calls SET reconnect_deadline = NULL, revision = revision + 1
         WHERE id = $1 RETURNING *",
    );

    Ok(update.bind(call_id).fetch_optional(connection).await?)
}

#[cfg(test)]
mod tests;
