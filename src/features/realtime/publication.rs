//! Publish realtime wakeups and disconnect revoked sessions.

use std::time::Duration;

use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::{
    RealtimeClient,
    wakeups::{WakeupOutcome, WakeupQueue},
};
use crate::features::accounts::AccountError;

const POLL_INTERVAL: Duration = Duration::from_secs(1);
const BATCH_SIZE: usize = 8;

pub(crate) struct DisconnectLoop<'a> {
    pub pool: &'a PgPool,
    pub client: Option<&'a RealtimeClient>,
    pub idle_days: i64,
    pub stop: CancellationToken,
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

async fn disconnect_batch(
    pool: &PgPool,
    client: &RealtimeClient,
    idle_days: i64,
) -> Result<(), AccountError> {
    let query = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT connection.user_id, connection.client_id FROM realtime_connections connection
         JOIN sessions session ON session.id = connection.session_id
         JOIN users account ON account.id = connection.user_id
         WHERE session.revoked_at IS NOT NULL OR session.expires_at <= now()
           OR session.last_seen_at <= now() - $1 * interval '1 day' OR account.is_suspended
         ORDER BY connection.client_id LIMIT $2",
    )
    .bind(idle_days)
    .bind(BATCH_SIZE as i64);
    let connections = query.fetch_all(pool).await?;
    for (user_id, client_id) in connections {
        // The external effect is idempotent; a crash before deletion simply disconnects again.
        client.disconnect(user_id, client_id).await?;
        sqlx::query("DELETE FROM realtime_connections WHERE client_id = $1")
            .bind(client_id)
            .execute(pool)
            .await?;
    }
    sqlx::query(
        "DELETE FROM realtime_connections WHERE client_id IN (
            SELECT client_id FROM realtime_connections WHERE expires_at <= now() LIMIT $1)",
    )
    .bind(BATCH_SIZE as i64)
    .execute(pool)
    .await?;

    Ok(())
}

/// Deliver durable wakeups while the realtime client is configured.
pub(crate) async fn publish(
    pool: &PgPool,
    client: Option<&RealtimeClient>,
    stop: CancellationToken,
) {
    let Some(client) = client else {
        return;
    };
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = stop.cancelled() => break,
            _ = interval.tick() => {
                if publish_batch(pool, client).await.is_err() {
                    tracing::warn!("wakeup_queue_unavailable");
                }
            }
        }
    }
}

/// Disconnect revoked or expired sessions while the realtime client is configured.
pub(crate) async fn disconnect(input: DisconnectLoop<'_>) {
    let DisconnectLoop {
        pool,
        client,
        idle_days,
        stop,
    } = input;
    let Some(client) = client else {
        return;
    };

    let mut interval = tokio::time::interval(POLL_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = stop.cancelled() => break,
            _ = interval.tick() => {
                if disconnect_batch(pool, client, idle_days).await.is_err() {
                    tracing::warn!("session_disconnect_unavailable");
                }
            }
        }
    }
}
