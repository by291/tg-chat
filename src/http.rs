//! Internal health endpoints and public HTTP response contracts.

use std::time::Instant;

use axum::{
    Extension, Json, Router,
    extract::{MatchedPath, Request, State},
    http::{HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use sqlx::PgPool;
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

use crate::{config::ServiceKind, database::ensure_ready};

const REQUEST_ID_HEADER: &str = "x-request-id";

#[derive(Clone)]
pub(crate) struct RequestId(pub(crate) String);

#[derive(Serialize, ToSchema)]
pub struct HealthResponse {
    status: HealthStatus,
    service: ServiceKind,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
enum HealthStatus {
    Ok,
}

#[derive(Serialize, ToSchema)]
pub struct ErrorResponse {
    error: ErrorDetails,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct ErrorDetails {
    pub(crate) code: &'static str,
    pub(crate) message: String,
    pub(crate) request_id: String,
}

#[derive(Clone)]
pub struct ApplicationState {
    pub pool: PgPool,
    pub service: ServiceKind,
}

#[derive(OpenApi)]
#[openapi(
    info(title = "TG Chat runtime API", version = "0.1.0"),
    paths(live, ready),
    modifiers(&AccountApi),
    components(schemas(HealthResponse, HealthStatus, ServiceKind, ErrorResponse, ErrorDetails))
)]
pub struct ApiDocument;

struct AccountApi;

impl utoipa::Modify for AccountApi {
    fn modify(&self, document: &mut utoipa::openapi::OpenApi) {
        document.merge(crate::accounts::http::AccountDocument::openapi());
        document.merge(crate::messages::http::MessageDocument::openapi());
        document.merge(crate::conversations::http::CommunityDocument::openapi());
        document.merge(crate::contacts::http::ContactDocument::openapi());
        document.merge(crate::media::http::MediaDocument::openapi());
        document.merge(crate::moderation::http::ModerationDocument::openapi());
        document.merge(crate::moderation::report_http::ReportDocument::openapi());
        document.merge(crate::accounts::email_http::EmailDocument::openapi());
        document.merge(crate::accounts::lifecycle_http::LifecycleDocument::openapi());
        document.merge(crate::accounts::preferences_http::PreferencesDocument::openapi());
    }
}

pub(crate) fn error_response(status: StatusCode, details: ErrorDetails) -> Response {
    (
        status,
        Json(ErrorResponse {
            error: details,
        }),
    )
        .into_response()
}

#[utoipa::path(
    get,
    path = "/health/live",
    responses((status = 200, description = "Process is running", body = HealthResponse))
)]
async fn live(State(state): State<ApplicationState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: HealthStatus::Ok,
        service: state.service,
    })
}

#[utoipa::path(
    get,
    path = "/health/ready",
    responses(
        (status = 200, description = "Database and schema are ready", body = HealthResponse),
        (status = 503, description = "Required dependency is unavailable", body = ErrorResponse)
    )
)]
async fn ready(
    State(state): State<ApplicationState>,
    Extension(request_id): Extension<RequestId>,
) -> Response {
    if ensure_ready(&state.pool).await.is_err() {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            ErrorDetails {
                code: "dependency_unavailable",
                message: "A required dependency is unavailable or its schema is not ready."
                    .to_owned(),
                request_id: request_id.0,
            },
        );
    }

    live(State(state)).await.into_response()
}

async fn not_found(Extension(request_id): Extension<RequestId>) -> Response {
    error_response(
        StatusCode::NOT_FOUND,
        ErrorDetails {
            code: "not_found",
            message: "The requested resource was not found.".to_owned(),
            request_id: request_id.0,
        },
    )
}

async fn method_not_allowed(Extension(request_id): Extension<RequestId>) -> Response {
    error_response(
        StatusCode::METHOD_NOT_ALLOWED,
        ErrorDetails {
            code: "method_not_allowed",
            message: "The request method is not supported for this resource.".to_owned(),
            request_id: request_id.0,
        },
    )
}

async fn observe_request(mut request: Request, next: Next) -> Response {
    // Generate our own IDs; untrusted request headers and URL queries must not enter logs.
    let request_id = Uuid::new_v4().to_string();
    let method = request.method().clone();
    let matched_path = request.extensions().get::<MatchedPath>();
    let route =
        matched_path.map(|path| path.as_str().to_owned()).unwrap_or_else(|| "unmatched".to_owned());
    request.extensions_mut().insert(RequestId(request_id.clone()));

    let started_at = Instant::now();
    let mut response = next.run(request).await;
    let header = HeaderValue::from_str(&request_id).expect("UUIDs are valid HTTP header values");
    response.headers_mut().insert(REQUEST_ID_HEADER, header);

    tracing::info!(
        request_id,
        %method,
        route,
        status = response.status().as_u16(),
        elapsed_ms = started_at.elapsed().as_millis(),
        "http_request"
    );

    response
}

/// Build the process health router without coupling liveness to external services.
pub fn router(state: ApplicationState) -> Router {
    router_with_api(state, Router::new())
}

/// Attach public API routes inside the common request-ID and sanitized logging boundary.
pub fn router_with_api(state: ApplicationState, api: Router) -> Router {
    let health = Router::new().route("/health/live", get(live)).route("/health/ready", get(ready));
    let routes = health.with_state(state).merge(api);
    let routes = routes.fallback(not_found).method_not_allowed_fallback(method_not_allowed);

    routes.layer(middleware::from_fn(observe_request))
}
