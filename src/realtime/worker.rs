use std::time::Duration;

use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::RealtimeClient;
use crate::{
    accounts::AccountError,
    jobs::{
        maintenance,
        wakeups::{WakeupOutcome, WakeupQueue},
    },
};

const POLL_INTERVAL: Duration = Duration::from_secs(1);
const BATCH_SIZE: usize = 8;

pub struct WorkerServices {
    pub pool: PgPool,
    pub client: Option<RealtimeClient>,
    pub idle_days: i64,
}

async fn publish_batch(pool: &PgPool, client: &RealtimeClient) -> Result<(), AccountError> {
    let queue = WakeupQueue::new(pool.clone());
    for _ in 0..BATCH_SIZE {
        let Some(claim) = queue.claim().await? else {
            break;
        };
        let outcome = match client.publish(pool, &claim).await {
            Ok(()) => WakeupOutcome::Published,
            Err(_) => {
                tracing::warn!("realtime_publication_unavailable");
                WakeupOutcome::Retry
            }
        };
        queue.finish(&claim, outcome).await?;
    }

    Ok(())
}

async fn disconnect_batch(services: &WorkerServices) -> Result<(), AccountError> {
    let Some(client) = &services.client else {
        return Ok(());
    };
    let query = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT connection.user_id, connection.client_id FROM realtime_connections connection
         JOIN sessions session ON session.id = connection.session_id
         JOIN users account ON account.id = connection.user_id
         WHERE session.revoked_at IS NOT NULL OR session.expires_at <= now()
           OR session.last_seen_at <= now() - $1 * interval '1 day' OR account.is_suspended
         ORDER BY connection.client_id LIMIT $2",
    )
    .bind(services.idle_days)
    .bind(BATCH_SIZE as i64);
    let connections = query.fetch_all(&services.pool).await?;
    for (user_id, client_id) in connections {
        // The external effect is idempotent; a crash before deletion simply disconnects again.
        client.disconnect(user_id, client_id).await?;
        sqlx::query("DELETE FROM realtime_connections WHERE client_id = $1")
            .bind(client_id)
            .execute(&services.pool)
            .await?;
    }
    sqlx::query(
        "DELETE FROM realtime_connections WHERE client_id IN (
            SELECT client_id FROM realtime_connections WHERE expires_at <= now() LIMIT $1)",
    )
    .bind(BATCH_SIZE as i64)
    .execute(&services.pool)
    .await?;

    Ok(())
}

async fn maintenance_batch(pool: &PgPool) -> Result<(), AccountError> {
    for _ in 0..BATCH_SIZE {
        if !maintenance::expire_one(pool).await? {
            break;
        }
    }
    maintenance::prune_one(pool).await?;
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

async fn publication_loop(services: &WorkerServices, stop: CancellationToken) {
    let Some(client) = &services.client else {
        return;
    };
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = stop.cancelled() => break,
            _ = interval.tick() => {
                if publish_batch(&services.pool, client).await.is_err() {
                    tracing::warn!("wakeup_queue_unavailable");
                }
            }
        }
    }
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

async fn disconnect_loop(services: &WorkerServices, stop: CancellationToken) {
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = stop.cancelled() => break,
            _ = interval.tick() => {
                if disconnect_batch(services).await.is_err() {
                    tracing::warn!("session_disconnect_unavailable");
                }
            }
        }
    }
}

/// Run independent bounded budgets so a realtime outage cannot starve expiry or revocation work.
pub async fn run(services: WorkerServices, stop: CancellationToken) {
    tokio::join!(
        publication_loop(&services, stop.clone()),
        maintenance_loop(&services.pool, stop.clone()),
        disconnect_loop(&services, stop),
    );
}
