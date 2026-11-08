//! Shared API and Worker startup and bounded shutdown.

use std::{collections::HashMap, future::IntoFuture, net::SocketAddr, time::Duration};

use thiserror::Error;
use tokio::{net::TcpListener, time::timeout};
use tokio_util::sync::CancellationToken;

use crate::{
    accounts::{
        AccountService, AccountSettings,
        http::{AccountHttpState, router as account_router},
        transport::HttpSettings,
    },
    config::{ServiceKind, Settings},
    database::connect_pool,
    http::{ApplicationState, router_with_api},
};

const GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);
const POOL_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("account runtime configuration is invalid")]
    AccountConfiguration,
    #[error("the configured HTTP listener could not be bound")]
    BindFailed,
    #[error("the HTTP service failed")]
    ServerFailed,
    #[error("shutdown signals could not be registered")]
    SignalFailed,
}

#[cfg(unix)]
async fn shutdown_signal() -> Result<(), RuntimeError> {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .map_err(|_| RuntimeError::SignalFailed)?;

    tokio::select! {
        outcome = tokio::signal::ctrl_c() => {
            outcome.map_err(|_| RuntimeError::SignalFailed)
        }
        _ = terminate.recv() => Ok(()),
    }
}

#[cfg(not(unix))]
async fn shutdown_signal() -> Result<(), RuntimeError> {
    tokio::signal::ctrl_c().await.map_err(|_| RuntimeError::SignalFailed)
}

/// Serve one process until shutdown, bounding both HTTP draining and pool cleanup.
pub async fn serve(settings: Settings, service: ServiceKind) -> Result<(), RuntimeError> {
    let pool = connect_pool(&settings.database);
    let listener =
        TcpListener::bind(settings.bind_address).await.map_err(|_| RuntimeError::BindFailed)?;
    let shutdown = CancellationToken::new();
    let account_routes = if matches!(service, ServiceKind::Api) {
        let values: HashMap<String, String> = std::env::vars().collect();
        let account_settings = AccountSettings::from_values(&values)
            .map_err(|_| RuntimeError::AccountConfiguration)?;
        let transport =
            HttpSettings::from_values(&values).map_err(|_| RuntimeError::AccountConfiguration)?;
        let accounts = AccountService::new(pool.clone(), account_settings);
        account_router(AccountHttpState::new(accounts, transport))
    } else {
        axum::Router::new()
    };
    let application = router_with_api(
        ApplicationState {
            pool: pool.clone(),
            service,
        },
        account_routes,
    );
    let application = application.into_make_service_with_connect_info::<SocketAddr>();
    let server = axum::serve(listener, application)
        .with_graceful_shutdown(shutdown.clone().cancelled_owned())
        .into_future();
    tokio::pin!(server);

    tracing::info!(?service, address = %settings.bind_address, "service_started");

    let outcome = tokio::select! {
        result = &mut server => result.map_err(|_| RuntimeError::ServerFailed),
        signal = shutdown_signal() => {
            signal?;
            // Stop accepting before draining requests; otherwise deployments can never finish.
            shutdown.cancel();
            tracing::info!(?service, "service_draining");
            match timeout(GRACEFUL_SHUTDOWN_TIMEOUT, &mut server).await {
                Ok(result) => result.map_err(|_| RuntimeError::ServerFailed),
                Err(_) => {
                    tracing::warn!(?service, "http_drain_deadline_reached");
                    Ok(())
                }
            }
        }
    };

    if timeout(POOL_SHUTDOWN_TIMEOUT, pool.close()).await.is_err() {
        tracing::warn!(?service, "database_drain_deadline_reached");
    }

    tracing::info!(?service, "service_stopped");
    outcome
}
