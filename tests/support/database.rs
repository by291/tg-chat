use std::time::Duration;

use sqlx::{PgConnection, PgPool};

const LOCK_WAIT_TIMEOUT: Duration = Duration::from_secs(10);
const LOCK_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Identify the backend that owns a test transaction's lock barrier.
pub async fn backend_pid(connection: &mut PgConnection) -> i32 {
    sqlx::query_scalar("SELECT pg_backend_pid()").fetch_one(connection).await.unwrap()
}

/// Wait until a competing backend reaches the lock held by the specified transaction.
pub async fn blocked_backend(pool: &PgPool, blocker: i32) -> i32 {
    let waiting = async {
        loop {
            let query = sqlx::query_scalar(
                "SELECT pid FROM pg_stat_activity
                 WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))
                 ORDER BY pid LIMIT 1",
            );
            if let Some(waiter) = query.bind(blocker).fetch_optional(pool).await.unwrap() {
                return waiter;
            }

            tokio::time::sleep(LOCK_POLL_INTERVAL).await;
        }
    };

    tokio::time::timeout(LOCK_WAIT_TIMEOUT, waiting)
        .await
        .expect("the competing operation reaches the held database lock")
}
