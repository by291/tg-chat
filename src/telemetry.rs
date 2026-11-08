//! Structured application logs with a narrow, credential-safe field policy.

use thiserror::Error;
use tracing::level_filters::LevelFilter;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Error)]
#[error("application logging could not be initialized")]
pub struct TelemetryError;

/// Install JSON logging without enabling dependency logs or environment-supplied filters.
pub fn initialize(level: LevelFilter) -> Result<(), TelemetryError> {
    // Dependency diagnostics can include connection URLs or SQL parameters. Only our explicit
    // application events are enabled; callers cannot broaden this with RUST_LOG.
    let filter = EnvFilter::new(format!("off,tg_chat={level}"));
    let subscriber = tracing_subscriber::fmt().with_env_filter(filter).json();
    let subscriber = subscriber.with_writer(std::io::stderr);

    subscriber.try_init().map_err(|_| TelemetryError)
}
