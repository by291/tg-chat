use std::{env, net::SocketAddr, process::ExitCode, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State, rejection::JsonRejection},
    http::StatusCode,
    routing::post,
};
use serde::Deserialize;
use tokio::{net::TcpListener, sync::Semaphore, time::Instant};

#[path = "link_preview_fetcher/fetch.rs"]
mod fetch;
#[path = "../network/public_address.rs"]
mod public_address;

const BIND_ENV: &str = "LINK_PREVIEW_FETCHER_BIND";
const DEFAULT_BIND: &str = "127.0.0.1:8091";
const MAX_ACTIVE_FETCHES: usize = 2;
const MAX_REQUEST_BYTES: usize = 16 * 1024;
const FETCH_DEADLINE: Duration = Duration::from_secs(5);

#[derive(Deserialize)]
struct PreviewRequest {
    url: String,
}

#[tokio::main]
async fn main() -> ExitCode {
    let bind = match env::var(BIND_ENV) {
        Ok(bind) => bind,
        Err(env::VarError::NotPresent) => DEFAULT_BIND.to_owned(),
        Err(_) => {
            eprintln!("Invalid link preview fetcher bind address");
            return ExitCode::FAILURE;
        }
    };

    let Ok(address) = bind.parse::<SocketAddr>() else {
        eprintln!("Invalid link preview fetcher bind address");
        return ExitCode::FAILURE;
    };
    let Ok(listener) = TcpListener::bind(address).await else {
        eprintln!("Could not listen for link preview requests");
        return ExitCode::FAILURE;
    };

    let app = preview_router(Arc::new(Semaphore::new(MAX_ACTIVE_FETCHES)));
    if axum::serve(listener, app).await.is_err() {
        eprintln!("Link preview fetcher stopped unexpectedly");
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}

fn preview_router(slots: Arc<Semaphore>) -> Router {
    Router::new()
        .route("/preview", post(preview))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(slots)
}

async fn preview(
    State(slots): State<Arc<Semaphore>>,
    request: Result<Json<PreviewRequest>, JsonRejection>,
) -> Result<Json<fetch::Preview>, (StatusCode, &'static str)> {
    // A single error message keeps framework and upstream diagnostics out of the control API.
    let failure = |status| (status, "Preview unavailable");
    let Json(request) = request.map_err(|error| failure(error.status()))?;
    let permit = slots.try_acquire_owned().map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;

    let deadline = Instant::now() + FETCH_DEADLINE;
    let html = tokio::time::timeout_at(deadline, fetch::fetch_html(&request.url)).await;
    let html = html.map_err(|_| failure(StatusCode::GATEWAY_TIMEOUT))?;
    let html = html.map_err(|error| match error {
        fetch::FetchError::Rejected => failure(StatusCode::BAD_REQUEST),
        fetch::FetchError::Unavailable => failure(StatusCode::BAD_GATEWAY),
    })?;

    // Keep the slot with the blocking parser even if the deadline ends the HTTP request first.
    let parser = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        fetch::parse_html(&html)
    });
    let preview = tokio::time::timeout_at(deadline, parser).await;
    let preview = preview.map_err(|_| failure(StatusCode::GATEWAY_TIMEOUT))?;
    let preview = preview.map_err(|_| failure(StatusCode::BAD_GATEWAY))?;
    let preview = preview.map_err(|_| failure(StatusCode::BAD_GATEWAY))?;

    Ok(Json(preview))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode, header},
    };
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::*;

    const REQUEST: &str = r#"{"url":"http://127.0.0.1/private"}"#;

    async fn send_preview(app: Router, body: &'static str) -> axum::response::Response {
        let request = Request::post("/preview")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap();

        app.oneshot(request).await.unwrap()
    }

    #[tokio::test]
    async fn hides_the_rejected_destination_from_the_http_response() {
        let app = preview_router(Arc::new(Semaphore::new(2)));
        let response = send_preview(app, REQUEST).await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert!(!String::from_utf8_lossy(&body).contains("127.0.0.1/private"));
    }

    #[tokio::test]
    async fn rejects_new_work_when_both_fetch_slots_are_occupied() {
        let slots = Arc::new(Semaphore::new(2));
        let _permit = slots.try_acquire_many(2).unwrap();
        let app = preview_router(Arc::clone(&slots));
        let response = send_preview(app, REQUEST).await;

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
}
