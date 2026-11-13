//! Schedule bounded work across backend features.

use std::{future::Future, time::Duration};

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
const BATCH_SIZE: u32 = 8;

pub struct WorkerServices {
    pub pool: PgPool,
    pub client: Option<RealtimeClient>,
    pub idle_days: i64,
}

async fn run_maintenance_task<Step>(task: &'static str, budget: u32, mut step: impl FnMut() -> Step)
where
    Step: Future<Output = Result<bool, AccountError>>,
{
    for _ in 0..budget {
        match step().await {
            Ok(true) => {}
            Ok(false) => break,
            Err(_) => {
                tracing::warn!(task, "maintenance_task_unavailable");
                break;
            }
        }
    }
}

async fn maintenance_batch(pool: &PgPool) {
    // A failing feature ends only its own batch so later retention work can still progress.
    run_maintenance_task("message_expiry", BATCH_SIZE, || maintenance::expire_one(pool)).await;
    run_maintenance_task("poll_closure", BATCH_SIZE, || maintenance::close_due_poll(pool)).await;

    run_maintenance_task("evidence_expiry", BATCH_SIZE, || evidence::expire_one(pool)).await;
    run_maintenance_task("account_cleanup", BATCH_SIZE, || cleanup_deleted_account(pool)).await;

    run_maintenance_task("sync_retention", 1, || retention::prune_one(pool)).await;
    run_maintenance_task("command_receipt_retention", 1, || {
        maintenance::prune_command_receipts(pool, i64::from(BATCH_SIZE))
    })
    .await;
}

async fn maintenance_loop(pool: &PgPool, stop: CancellationToken) {
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = stop.cancelled() => break,
            _ = interval.tick() => maintenance_batch(pool).await,
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
