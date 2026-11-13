use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderValue, header},
    response::Response,
    routing::{get, post},
};
use futures_util::StreamExt;
use serde::Deserialize;
use tokio_util::io::ReaderStream;
use utoipa::{IntoParams, OpenApi};
use uuid::Uuid;

use super::{
    evidence::{AttachmentAccess, CaseDetail, CasePage},
    reports::{ReportMessage, ReportReceipt},
};
use crate::features::accounts::{
    AccountError,
    extractors::{ActorContext, ApiFailure, SafeJson, SafeQuery},
    http::AccountHttpState,
};

const MAX_DOWNLOAD_TIME: std::time::Duration = std::time::Duration::from_secs(120);

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
struct CaseQuery {
    after: Option<Uuid>,
}

#[derive(OpenApi)]
#[openapi(paths(report_message, cases, case_detail, case_original))]
pub struct ReportDocument;

#[utoipa::path(
    post, path = "/api/v1/messages/{message_id}/reports",
    params(("message_id" = Uuid, Path)), request_body = ReportMessage,
    responses((status = 200, body = ReportReceipt))
)]
async fn report_message(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(message_id): Path<Uuid>,
    SafeJson(input): SafeJson<ReportMessage>,
) -> Result<Json<ReportReceipt>, ApiFailure> {
    let receipt = state
        .accounts
        .report_message(context.actor, message_id, input)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(receipt))
}

#[utoipa::path(
    get, path = "/api/v1/operator/cases", params(CaseQuery),
    responses((status = 200, body = CasePage))
)]
async fn cases(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeQuery(query): SafeQuery<CaseQuery>,
) -> Result<Json<CasePage>, ApiFailure> {
    let page = state
        .accounts
        .report_cases(&context.actor, query.after)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(page))
}

#[utoipa::path(
    get, path = "/api/v1/operator/cases/{case_id}", params(("case_id" = Uuid, Path)),
    responses((status = 200, body = CaseDetail))
)]
async fn case_detail(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(case_id): Path<Uuid>,
) -> Result<Json<CaseDetail>, ApiFailure> {
    let detail = state
        .accounts
        .report_case(&context.actor, case_id)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(detail))
}

#[utoipa::path(
    get, path = "/api/v1/operator/cases/{case_id}/attachments/{occurrence_id}",
    params(("case_id" = Uuid, Path), ("occurrence_id" = Uuid, Path)),
    responses((status = 200, description = "Private original attachment stream"))
)]
async fn case_original(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path((case_id, occurrence_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, ApiFailure> {
    let input = AttachmentAccess {
        case_id,
        occurrence_id,
    };
    let file = state
        .accounts
        .case_attachment(&context.actor, input)
        .await
        .map_err(|error| context.request.failure(error))?;
    let media = state.media.ok_or_else(|| context.request.failure(AccountError::Unavailable))?;
    let stream = media
        .open_evidence_original(file.file_id)
        .await
        .map_err(|error| context.request.failure(error))?;

    // Keep the original behind the case authorization and prevent slow downloads living forever.
    let chunks = ReaderStream::new(stream.into_async_read());
    let chunks = chunks.take_until(tokio::time::sleep(MAX_DOWNLOAD_TIME));
    let filename: String =
        url::form_urlencoded::byte_serialize(file.file_name.as_bytes()).collect();
    let filename = filename.replace('+', "%20");
    let disposition = format!("attachment; filename*=UTF-8''{filename}");
    let mut response = Response::new(Body::from_stream(chunks));
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition).expect("encoded file name is a valid header"),
    );
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(file.size_bytes));

    Ok(response)
}

/// Mount authenticated report admission and restricted operator evidence routes.
pub(crate) fn router() -> Router<AccountHttpState> {
    let routes = Router::new().route("/messages/{message_id}/reports", post(report_message));
    routes
        .route("/operator/cases", get(cases))
        .route("/operator/cases/{case_id}", get(case_detail))
        .route("/operator/cases/{case_id}/attachments/{occurrence_id}", get(case_original))
}
