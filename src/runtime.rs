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
    calls::{
        CallService,
        livekit::LiveKit,
        reconciliation::{Reconciliation, ReconciliationSettings},
        room_work::RoomWork,
        rooms::CallRooms,
        signaling, webhook_http,
    },
    config::{ServiceKind, Settings},
    database::connect_pool,
    http::{ApplicationState, router_with_api},
    jobs::{MailQueue, MailSettings, link_previews::LinkPreviews},
    media::{
        MediaCleanup, MediaLimits, MediaStorageSettings, MediaWorker, MediaWorkerSettings,
        UploadService,
    },
    notifications::{
        NotificationService,
        delivery::{PushRuntime, PushWorker},
    },
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
    let livekit = match LiveKit::from_values(&values) {
        Ok(provider) => provider,
        Err(_) => {
            // Calls are optional even when their deployment configuration is incomplete.
            tracing::warn!("call_provider_configuration_unavailable");
            None
        }
    };
    let worker = if matches!(service, ServiceKind::Worker) {
        let queue = mail.clone();
        let stop = shutdown.clone();
        let services = WorkerServices {
            pool: pool.clone(),
            client: realtime_client.clone(),
            idle_days: account_settings.idle_days,
        };
        let rooms = livekit
            .clone()
            .map(|provider| RoomWork::new(pool.clone(), provider, realtime_client.clone()));
        let reconcile = livekit.clone().map(|provider| {
            Reconciliation::new(ReconciliationSettings {
                pool: pool.clone(),
                provider,
                realtime: realtime_client.clone(),
                idle_days: account_settings.idle_days,
            })
        });
        let previews =
            values.get("TG_CHAT_LINK_PREVIEW_ENDPOINT").filter(|value| !value.is_empty());
        let previews = previews.and_then(|endpoint| {
            let result = reqwest::Url::parse(endpoint)
                .map_err(|_| ())
                .and_then(|url| LinkPreviews::new(pool.clone(), url).map_err(|_| ()));
            match result {
                Ok(worker) => Some(worker),
                Err(()) => {
                    // Invalid isolation settings disable preview jobs without affecting messaging.
                    tracing::warn!("link_preview_configuration_unavailable");
                    None
                }
            }
        });
        let transport =
            HttpSettings::from_values(&values).map_err(|_| RuntimeError::AccountConfiguration)?;
        let activity_accounts = AccountService::new(pool.clone(), account_settings.clone());
        let activity = realtime::Activity::new(activity_accounts, &transport, None);
        let push = PushWorker::from_values(PushRuntime {
            pool: pool.clone(),
            activity: Some(activity),
            idle_days: account_settings.idle_days,
            values: &values,
        });
        let media = if let Some(storage) = media_storage.clone() {
            let settings =
                MediaWorkerSettings::from_env().map_err(|_| RuntimeError::MediaConfiguration)?;
            let preparation = MediaWorker::new(pool.clone(), storage.clone(), settings);
            let cleanup = MediaCleanup::new(pool.clone(), storage);
            Some((preparation, cleanup))
        } else {
            None
        };
        Some(tokio::spawn(async move {
            let prepare_media = async {
                if let Some((worker, cleanup)) = media {
                    tokio::join!(worker.run(stop.clone()), cleanup.run(stop.clone()));
                }
            };
            let prepare_previews = async {
                if let Some(previews) = previews {
                    previews.run(stop.clone()).await;
                }
            };
            let prepare_rooms = async {
                if let (Some(rooms), Some(reconcile)) = (rooms, reconcile) {
                    tokio::join!(rooms.run(stop.clone()), reconcile.run(stop.clone()));
                }
            };
            tokio::join!(
                queue.run(stop.clone()),
                realtime::run(services, stop.clone()),
                prepare_media,
                prepare_previews,
                push.run(stop.clone()),
                prepare_rooms,
            );
        }))
    } else {
        None
    };
    let account_routes = if matches!(service, ServiceKind::Api) {
        let transport =
            HttpSettings::from_values(&values).map_err(|_| RuntimeError::AccountConfiguration)?;
        let accounts = AccountService::new(pool.clone(), account_settings);
        let call_capacity = match CallService::capacity_from_values(&values) {
            Ok(capacity) => Some(capacity),
            Err(_) => {
                tracing::warn!("call_capacity_configuration_unavailable");
                None
            }
        };
        let calls = call_capacity.map(|capacity| {
            let service = CallService::new(accounts.clone()).with_capacity(capacity);
            service.with_realtime(realtime_client.clone())
        });
        let notifications = NotificationService::from_values(accounts.clone(), &values);
        let state = AccountHttpState::new(accounts.clone(), transport, mail);
        let mut state = state.with_activity_realtime(realtime_client);
        state = state.with_notifications(notifications);
        if let Some(media) = media_storage {
            let limits = MediaLimits::from_env().map_err(|_| RuntimeError::MediaConfiguration)?;
            state = state.with_media(UploadService::new(accounts.clone(), limits, media));
        }
        let mut private_calls = axum::Router::new();
        if let (Some(provider), Some(calls)) = (livekit, calls) {
            let rooms = CallRooms::new(pool.clone(), calls.clone(), provider.clone());
            private_calls = signaling::router(rooms.clone());
            private_calls = private_calls.merge(webhook_http::router(pool.clone(), provider));
            state = state.with_calls(calls).with_call_rooms(rooms);
        }
        let routes = account_router(state).merge(private_calls);
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
