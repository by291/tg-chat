//! Leased provider room setup and terminal cleanup.

use std::time::Duration;

use sqlx::{FromRow, PgPool};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{accounts::AccountError, realtime::RealtimeClient};

use super::{
    livekit::LiveKit,
    model::CallPhase,
    service::{LockCall, database_now, lock_call, publish_hint},
};

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const LEASE_SECONDS: i32 = 10;
const RETRY_SECONDS: i32 = 3;
const UNCERTAIN_CREATE_SECONDS: i32 = 45;

pub(crate) struct RoomWork {
    pool: PgPool,
    provider: LiveKit,
    realtime: Option<RealtimeClient>,
}

#[derive(FromRow)]
struct CreateClaim {
    call_id: Uuid,
    room_name: String,
    create_lease_id: Uuid,
}

#[derive(FromRow)]
struct CleanupClaim {
    call_id: Uuid,
    room_name: Option<String>,
    lease_id: Uuid,
}

impl RoomWork {
    /// Share the database and optional hint publisher with provider room jobs.
    pub(crate) fn new(pool: PgPool, provider: LiveKit, realtime: Option<RealtimeClient>) -> Self {
        Self {
            pool,
            provider,
            realtime,
        }
    }

    /// Process one room job at a time until the Worker shuts down.
    pub(crate) async fn run(&self, stop: CancellationToken) {
        loop {
            let result = tokio::select! {
                () = stop.cancelled() => return,
                result = self.process() => result,
            };
            match result {
                Ok(true) => continue,
                Ok(false) => {}
                Err(_) => tracing::warn!("call_room_work_unavailable"),
            }

            tokio::select! {
                () = stop.cancelled() => return,
                () = tokio::time::sleep(POLL_INTERVAL) => {}
            }
        }
    }

    async fn process(&self) -> Result<bool, AccountError> {
        if let Some(claim) = self.claim_cleanup().await? {
            self.finish_cleanup(claim).await?;

            return Ok(true);
        }
        self.reserve_room().await?;
        let Some(claim) = self.claim_create().await? else {
            return Ok(false);
        };
        let created = self.provider.create(&claim.room_name).await;
        match created {
            Ok(sid) => self.publish_create(claim, sid).await?,
            Err(_) => self.retry_create(claim).await?,
        }

        Ok(true)
    }

    async fn reserve_room(&self) -> Result<(), AccountError> {
        let insert = sqlx::query(
            "INSERT INTO call_rooms (call_id, room_name, caller_identity, recipient_identity)
             SELECT call.id, 'call-' || gen_random_uuid()::text,
                 gen_random_uuid(), gen_random_uuid()
             FROM calls call WHERE call.phase = 'connecting'
               AND call.setup_deadline > clock_timestamp()
               AND NOT EXISTS (SELECT 1 FROM call_rooms room WHERE room.call_id = call.id)
             ORDER BY call.setup_deadline, call.id LIMIT 1
             ON CONFLICT (call_id) DO NOTHING",
        );
        insert.execute(&self.pool).await?;

        Ok(())
    }

    async fn claim_create(&self) -> Result<Option<CreateClaim>, AccountError> {
        let query = sqlx::query_as(
            "WITH candidate AS (
                 SELECT room.call_id FROM call_rooms room JOIN calls call ON call.id = room.call_id
                 WHERE call.phase = 'connecting' AND call.setup_deadline > clock_timestamp()
                   AND room.provider_sid IS NULL AND room.create_after <= clock_timestamp()
                   AND (room.create_lease_until IS NULL
                     OR room.create_lease_until <= clock_timestamp())
                 ORDER BY room.create_after, room.call_id LIMIT 1 FOR UPDATE OF room SKIP LOCKED
             )
             UPDATE call_rooms room SET create_lease_id = $1,
               create_lease_until = clock_timestamp() + make_interval(secs => $2),
               cleanup_safe_at = GREATEST(room.cleanup_safe_at,
                   room.create_lease_until + make_interval(secs => $3))
             FROM candidate WHERE room.call_id = candidate.call_id
             RETURNING room.call_id, room.room_name, room.create_lease_id",
        );
        let query = query.bind(Uuid::new_v4()).bind(LEASE_SECONDS).bind(UNCERTAIN_CREATE_SECONDS);

        Ok(query.fetch_optional(&self.pool).await?)
    }

    async fn publish_create(&self, claim: CreateClaim, sid: String) -> Result<(), AccountError> {
        let mut transaction = self.pool.begin().await?;
        let mut call = lock_call(
            &mut transaction,
            LockCall {
                call_id: claim.call_id,
                actor: None,
            },
        )
        .await?;
        let now = database_now(&mut transaction).await?;

        // A late provider success must never make a terminal call joinable.
        let can_publish = call.phase == CallPhase::Connecting
            && call.setup_deadline.is_some_and(|deadline| deadline > now);
        let update = sqlx::query(
            "UPDATE call_rooms SET provider_sid = $3, create_lease_id = NULL,
                 create_lease_until = NULL
             WHERE call_id = $1 AND create_lease_id = $2
               AND create_lease_until > clock_timestamp()",
        );
        let ready_sid = can_publish.then_some(sid);
        let update = update.bind(claim.call_id).bind(claim.create_lease_id).bind(ready_sid);
        let changed = update.execute(&mut *transaction).await?.rows_affected() > 0;

        if changed && can_publish {
            let bump = sqlx::query_scalar(
                "UPDATE calls SET revision = revision + 1 WHERE id = $1
                                    RETURNING revision",
            );
            call.revision = bump.bind(call.id).fetch_one(&mut *transaction).await?;
        }
        if call.phase == CallPhase::Ended {
            let cleanup = sqlx::query(
                "INSERT INTO call_room_cleanup (call_id, revision) VALUES ($1, $2)
                 ON CONFLICT (call_id) DO NOTHING",
            );
            cleanup.bind(call.id).bind(call.revision).execute(&mut *transaction).await?;
        }
        transaction.commit().await?;

        if changed && can_publish {
            publish_hint(self.realtime.as_ref(), &call).await;
        }

        Ok(())
    }

    async fn retry_create(&self, claim: CreateClaim) -> Result<(), AccountError> {
        // A later success cannot resolve the outcome of this timed-out provider request.
        let retry = sqlx::query(
            "UPDATE call_rooms SET create_after = clock_timestamp() + make_interval(secs => $3),
                 cleanup_safe_at = GREATEST(cleanup_safe_at,
                     clock_timestamp() + make_interval(secs => $4)),
                 create_lease_id = NULL, create_lease_until = NULL
             WHERE call_id = $1 AND create_lease_id = $2",
        );
        let retry = retry.bind(claim.call_id).bind(claim.create_lease_id).bind(RETRY_SECONDS);
        let retry = retry.bind(UNCERTAIN_CREATE_SECONDS);
        retry.execute(&self.pool).await?;

        Ok(())
    }

    async fn claim_cleanup(&self) -> Result<Option<CleanupClaim>, AccountError> {
        let query = sqlx::query_as(
            "WITH candidate AS (
                 SELECT work.call_id, room.room_name FROM call_room_cleanup work
                 LEFT JOIN call_rooms room ON room.call_id = work.call_id
                 WHERE work.available_at <= clock_timestamp()
                   AND (work.lease_until IS NULL OR work.lease_until <= clock_timestamp())
                   AND (room.cleanup_safe_at IS NULL OR room.cleanup_safe_at <= clock_timestamp())
                   AND (room.create_lease_until IS NULL
                     OR room.create_lease_until + make_interval(secs => $3) <= clock_timestamp())
                 ORDER BY work.available_at, work.call_id LIMIT 1 FOR UPDATE OF work SKIP LOCKED
             )
             UPDATE call_room_cleanup work SET lease_id = $1,
                 lease_until = clock_timestamp() + make_interval(secs => $2)
             FROM candidate WHERE work.call_id = candidate.call_id
             RETURNING work.call_id, candidate.room_name, work.lease_id",
        );
        let query = query.bind(Uuid::new_v4()).bind(LEASE_SECONDS).bind(UNCERTAIN_CREATE_SECONDS);

        Ok(query.fetch_optional(&self.pool).await?)
    }

    async fn finish_cleanup(&self, claim: CleanupClaim) -> Result<(), AccountError> {
        let removed = match claim.room_name {
            Some(name) => self.provider.delete(&name).await.is_ok(),
            None => true,
        };
        if removed {
            let acknowledge =
                sqlx::query("DELETE FROM call_room_cleanup WHERE call_id = $1 AND lease_id = $2");
            acknowledge.bind(claim.call_id).bind(claim.lease_id).execute(&self.pool).await?;

            return Ok(());
        }

        let retry = sqlx::query(
            "UPDATE call_room_cleanup
             SET available_at = clock_timestamp() + make_interval(secs => $3),
                 lease_id = NULL, lease_until = NULL
             WHERE call_id = $1 AND lease_id = $2",
        );
        let retry = retry.bind(claim.call_id).bind(claim.lease_id).bind(RETRY_SECONDS);
        retry.execute(&self.pool).await?;

        Ok(())
    }
}

#[cfg(test)]
mod tests;
