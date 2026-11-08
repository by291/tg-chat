//! PostgreSQL pool, schema readiness, and explicit migration boundaries.

use std::time::Duration;

use sqlx::{Connection, PgPool, migrate::Migrator, postgres::PgPoolOptions};
use thiserror::Error;
use tokio::time::timeout;

use crate::config::DatabaseSettings;

const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(2);
const READINESS_TIMEOUT: Duration = Duration::from_secs(3);
const MIGRATION_TIMEOUT: Duration = Duration::from_secs(300);

pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("PostgreSQL is unavailable or its schema is not ready")]
    NotReady,
    #[error("PostgreSQL migrations could not be applied")]
    MigrationFailed,
}

/// Build a lazy pool so database outages do not disable process health endpoints.
pub fn connect_pool(settings: &DatabaseSettings) -> PgPool {
    let pool_options = PgPoolOptions::new()
        .max_connections(settings.max_connections)
        .acquire_timeout(ACQUIRE_TIMEOUT);

    pool_options.connect_lazy_with(settings.connection_options())
}

/// Apply a resolved migration catalogue using PostgreSQL migration locking.
pub async fn migrate(pool: &PgPool, migrator: &Migrator) -> Result<(), StorageError> {
    let acquired = pool.acquire().await.map_err(|_| StorageError::NotReady)?;
    // SQLx can leave a session advisory lock after failure. A dedicated connection prevents
    // that lock from leaking back into the pool, including when this future is cancelled.
    let mut connection = acquired.detach();
    let outcome = timeout(MIGRATION_TIMEOUT, migrator.run(&mut connection)).await;

    connection.close().await.map_err(|_| StorageError::MigrationFailed)?;
    outcome.map_err(|_| StorageError::MigrationFailed)?.map_err(|_| StorageError::MigrationFailed)
}

async fn check_schema(pool: &PgPool) -> Result<(), StorageError> {
    let applied: Vec<(i64, Vec<u8>, bool)> =
        sqlx::query_as("SELECT version, checksum, success FROM _sqlx_migrations ORDER BY version")
            .fetch_all(pool)
            .await
            .map_err(|_| StorageError::NotReady)?;
    let expected: Vec<_> =
        MIGRATOR.iter().filter(|migration| !migration.migration_type.is_down_migration()).collect();

    if applied.len() != expected.len() {
        return Err(StorageError::NotReady);
    }

    for (stored, migration) in applied.iter().zip(expected) {
        let is_valid = stored.0 == migration.version
            && stored.1.as_slice() == migration.checksum.as_ref()
            && stored.2;
        if !is_valid {
            return Err(StorageError::NotReady);
        }
    }

    Ok(())
}

/// Check connectivity and the embedded schema catalogue within a bounded probe deadline.
pub async fn ensure_ready(pool: &PgPool) -> Result<(), StorageError> {
    timeout(READINESS_TIMEOUT, check_schema(pool)).await.map_err(|_| StorageError::NotReady)?
}
