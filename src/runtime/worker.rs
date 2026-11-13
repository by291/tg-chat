//! Schedule bounded work across backend features.

use std::time::Duration;

use sqlx::PgPool;
use tokio_util::sync::CancellationToken;

use crate::features::{
    accounts::{AccountError, cleanup::cleanup_deleted_account},
    calls::{
        history,
        termination::{self, TerminationBatch},
    },
    messages::maintenance,
    moderation::evidence,
    realtime::{RealtimeClient, publication},
    sync::retention,
};

const POLL_INTERVAL: Duration = Duration::from_secs(1);
const BATCH_SIZE: usize = 8;

pub struct WorkerServices {
    pub pool: PgPool,
    pub client: Option<RealtimeClient>,
    pub idle_days: i64,
}

async fn maintenance_batch(pool: &PgPool) -> Result<(), AccountError> {
    for _ in 0..BATCH_SIZE {
        if !maintenance::expire_one(pool).await? {
            break;
        }
    }
    for _ in 0..BATCH_SIZE {
        if !maintenance::close_due_poll(pool).await? {
            break;
        }
    }
    for _ in 0..BATCH_SIZE {
        if !evidence::expire_one(pool).await? {
            break;
        }
    }
    for _ in 0..BATCH_SIZE {
        if !cleanup_deleted_account(pool).await? {
            break;
        }
    }
    retention::prune_one(pool).await?;
    // General command receipts are bounded separately from permanent send identity bindings.
    sqlx::query(
        "DELETE FROM command_receipts WHERE (actor_id, operation_id) IN (
            SELECT actor_id, operation_id FROM command_receipts
            WHERE created_at < now() - interval '7 days' ORDER BY created_at LIMIT $1)",
    )
    .bind(BATCH_SIZE as i64)
    .execute(pool)
    .await?;

    Ok(())
}

async fn maintenance_loop(pool: &PgPool, stop: CancellationToken) {
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = stop.cancelled() => break,
            _ = interval.tick() => {
                if maintenance_batch(pool).await.is_err() {
                    tracing::warn!("message_maintenance_unavailable");
                }
            }
        }
    }
}

async fn call_termination_loop(services: &WorkerServices, stop: CancellationToken) {
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = stop.cancelled() => break,
            _ = interval.tick() => {
                let batch = TerminationBatch {
                    pool: &services.pool,
                    client: services.client.as_ref(),
                    idle_days: services.idle_days,
                };
                if termination::terminate_due_calls(batch).await.is_err() {
                    tracing::warn!("call_termination_unavailable");
                }
            }
        }
    }
}

async fn call_history_batch(pool: &PgPool) -> Result<(), AccountError> {
    for _ in 0..BATCH_SIZE {
        if !history::publish_one(pool).await? {
            break;
        }
    }

    Ok(())
}

async fn call_history_loop(pool: &PgPool, stop: CancellationToken) {
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = stop.cancelled() => break,
            _ = interval.tick() => {
                if call_history_batch(pool).await.is_err() {
                    tracing::warn!("call_history_unavailable");
                }
            }
        }
    }
}

/// Run independent bounded budgets so a realtime outage cannot starve expiry or revocation work.
pub async fn run(services: WorkerServices, stop: CancellationToken) {
    tokio::join!(
        publication::publish(&services.pool, services.client.as_ref(), stop.clone()),
        maintenance_loop(&services.pool, stop.clone()),
        publication::disconnect(publication::DisconnectLoop {
            pool: &services.pool,
            client: services.client.as_ref(),
            idle_days: services.idle_days,
            stop: stop.clone(),
        }),
        call_termination_loop(&services, stop.clone()),
        call_history_loop(&services.pool, stop),
    );
}
