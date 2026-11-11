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
    jobs::{MailQueue, MailSettings},
    media::{MediaLimits, MediaStorageSettings, MediaWorker, MediaWorkerSettings, UploadService},
    realtime::{self, RealtimeClient, RealtimeSettings, WorkerServices},
};

const GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);
const WORKER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(30);
const POOL_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("account runtime configuration is invalid")]
    AccountConfiguration,
    #[error("the configured HTTP listener could not be bound")]
    BindFailed,
    #[error("media runtime configuration is invalid")]
    MediaConfiguration,
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

async fn drain_worker(worker: Option<tokio::task::JoinHandle<()>>) {
    let Some(mut worker) = worker else {
        return;
    };
    if timeout(WORKER_SHUTDOWN_TIMEOUT, &mut worker).await.is_ok() {
        return;
    }

    worker.abort();
    let _ = worker.await;
    tracing::warn!("worker_drain_deadline_reached");
}

/// Serve one process until shutdown, bounding both HTTP draining and pool cleanup.
pub async fn serve(settings: Settings, service: ServiceKind) -> Result<(), RuntimeError> {
    let pool = connect_pool(&settings.database);
    let listener =
        TcpListener::bind(settings.bind_address).await.map_err(|_| RuntimeError::BindFailed)?;
    let shutdown = CancellationToken::new();
    let values: HashMap<String, String> = std::env::vars().collect();
    let mail_settings =
        MailSettings::from_values(&values).map_err(|_| RuntimeError::AccountConfiguration)?;
    let mail = MailQueue::new(pool.clone(), mail_settings)
        .map_err(|_| RuntimeError::AccountConfiguration)?;
    let realtime_settings =
        RealtimeSettings::from_values(&values).map_err(|_| RuntimeError::AccountConfiguration)?;
    let account_settings =
        AccountSettings::from_values(&values).map_err(|_| RuntimeError::AccountConfiguration)?;
    let realtime_client = realtime_settings
        .clone()
        .map(RealtimeClient::new)
        .transpose()
        .map_err(|_| RuntimeError::AccountConfiguration)?;
    let media_storage =
        MediaStorageSettings::from_env().map_err(|_| RuntimeError::MediaConfiguration)?;
    let worker = if matches!(service, ServiceKind::Worker) {
        let queue = mail.clone();
        let stop = shutdown.clone();
        let services = WorkerServices {
            pool: pool.clone(),
            client: realtime_client,
            idle_days: account_settings.idle_days,
        };
        let media = if let Some(storage) = media_storage.clone() {
            let settings =
                MediaWorkerSettings::from_env().map_err(|_| RuntimeError::MediaConfiguration)?;
            Some(MediaWorker::new(pool.clone(), storage, settings))
        } else {
            None
        };
        Some(tokio::spawn(async move {
            let prepare_media = async {
                if let Some(worker) = media {
                    worker.run(stop.clone()).await;
                }
            };
            tokio::join!(
                queue.run(stop.clone()),
                realtime::run(services, stop.clone()),
                prepare_media
            );
        }))
    } else {
        None
    };
    let account_routes = if matches!(service, ServiceKind::Api) {
        let transport =
            HttpSettings::from_values(&values).map_err(|_| RuntimeError::AccountConfiguration)?;
        let accounts = AccountService::new(pool.clone(), account_settings);
        let mut state = AccountHttpState::new(accounts.clone(), transport, mail);
        if let Some(media) = media_storage {
            let limits = MediaLimits::from_env().map_err(|_| RuntimeError::MediaConfiguration)?;
            state = state.with_media(UploadService::new(accounts.clone(), limits, media));
        }
        let routes = account_router(state);
        match realtime_settings {
            Some(settings) => routes.merge(realtime::router(accounts, settings)),
            None => routes,
        }
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

    shutdown.cancel();
    drain_worker(worker).await;

    if timeout(POOL_SHUTDOWN_TIMEOUT, pool.close()).await.is_err() {
        tracing::warn!(?service, "database_drain_deadline_reached");
    }

    tracing::info!(?service, "service_stopped");
    outcome
}
