//! Validated process configuration with credential-safe diagnostics.

use std::{collections::HashMap, fmt, net::SocketAddr, str::FromStr};

use serde::Serialize;
use sqlx::{ConnectOptions, postgres::PgConnectOptions};
use thiserror::Error;
use tracing::level_filters::LevelFilter;
use utoipa::ToSchema;

const API_BIND_ADDRESS: &str = "127.0.0.1:8080";
const WORKER_BIND_ADDRESS: &str = "127.0.0.1:8081";
const DEFAULT_POOL_SIZE: u32 = 5;
const MAX_POOL_SIZE: u32 = 100;

#[derive(Clone, Copy, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ServiceKind {
    Api,
    Worker,
}

#[derive(Clone)]
pub struct DatabaseSettings {
    options: PgConnectOptions,
    pub max_connections: u32,
}

impl DatabaseSettings {
    /// Copy the validated connection options for a database pool.
    pub fn connection_options(&self) -> PgConnectOptions {
        self.options.clone()
    }
}

impl fmt::Debug for DatabaseSettings {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Connection options contain credentials and must never enter diagnostic output.
        formatter.write_str("DatabaseSettings { credentials: [REDACTED] }")
    }
}

#[derive(Debug)]
pub struct Settings {
    pub database: DatabaseSettings,
    pub bind_address: SocketAddr,
    pub log_level: LevelFilter,
}

#[derive(Debug, Error)]
#[error("{variable}: {reason}")]
pub struct ConfigurationError {
    variable: &'static str,
    reason: &'static str,
}

fn invalid(variable: &'static str, reason: &'static str) -> ConfigurationError {
    ConfigurationError {
        variable,
        reason,
    }
}

fn database_settings(
    values: &HashMap<String, String>,
) -> Result<DatabaseSettings, ConfigurationError> {
    let variable = "TG_CHAT_DATABASE_URL";
    let database_url = values
        .get(variable)
        .ok_or_else(|| invalid(variable, "a PostgreSQL connection URL is required"))?;
    let has_postgres_scheme =
        database_url.starts_with("postgres://") || database_url.starts_with("postgresql://");

    if !has_postgres_scheme {
        return Err(invalid(variable, "a PostgreSQL connection URL is required"));
    }

    let options = PgConnectOptions::from_str(database_url)
        .map_err(|_| invalid(variable, "the PostgreSQL connection URL is invalid"))?
        .disable_statement_logging();
    let max_connections = pool_size(values)?;

    Ok(DatabaseSettings {
        options,
        max_connections,
    })
}

fn pool_size(values: &HashMap<String, String>) -> Result<u32, ConfigurationError> {
    let variable = "TG_CHAT_DB_MAX_CONNECTIONS";
    let Some(value) = values.get(variable) else {
        return Ok(DEFAULT_POOL_SIZE);
    };

    let connections = value
        .parse::<u32>()
        .map_err(|_| invalid(variable, "an integer between 1 and 100 is required"))?;
    if !(1..=MAX_POOL_SIZE).contains(&connections) {
        return Err(invalid(variable, "an integer between 1 and 100 is required"));
    }

    Ok(connections)
}

impl Settings {
    /// Read and validate the environment for one process without printing credentials.
    pub fn from_env(service: ServiceKind) -> Result<Self, ConfigurationError> {
        let variables = [
            "TG_CHAT_DATABASE_URL",
            "TG_CHAT_BIND_ADDRESS",
            "TG_CHAT_DB_MAX_CONNECTIONS",
            "TG_CHAT_LOG_LEVEL",
        ];
        let mut values = HashMap::new();

        for variable in variables {
            match std::env::var(variable) {
                Ok(value) => {
                    values.insert(variable.to_owned(), value);
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(std::env::VarError::NotUnicode(_)) => {
                    return Err(invalid(variable, "valid Unicode is required"));
                }
            }
        }

        Self::from_values(&values, service)
    }

    /// Validate process settings without changing the caller's environment.
    pub fn from_values(
        values: &HashMap<String, String>,
        service: ServiceKind,
    ) -> Result<Self, ConfigurationError> {
        let database = database_settings(values)?;
        let default_bind_address = match service {
            ServiceKind::Api => API_BIND_ADDRESS,
            ServiceKind::Worker => WORKER_BIND_ADDRESS,
        };
        let bind_value =
            values.get("TG_CHAT_BIND_ADDRESS").map(String::as_str).unwrap_or(default_bind_address);
        let bind_address = bind_value
            .parse()
            .map_err(|_| invalid("TG_CHAT_BIND_ADDRESS", "an IP address and port are required"))?;

        let level_value = values.get("TG_CHAT_LOG_LEVEL").map(String::as_str).unwrap_or("info");
        let log_level = LevelFilter::from_str(level_value).map_err(|_| {
            invalid("TG_CHAT_LOG_LEVEL", "use off, error, warn, info, debug, or trace")
        })?;

        Ok(Self {
            database,
            bind_address,
            log_level,
        })
    }
}
