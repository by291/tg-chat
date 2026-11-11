use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post},
};
use utoipa::OpenApi;
use uuid::Uuid;

use crate::accounts::{
    AccountError,
    extractors::{ActorContext, ApiFailure, SafeJson},
    http::AccountHttpState,
};

use super::{ReserveUpload, TransferPlan, TransferRequest, UploadService, UploadStatus};

#[derive(OpenApi)]
#[openapi(paths(reserve, status, transfer, complete, cancel))]
pub(crate) struct MediaDocument;

fn uploads<'a>(
    state: &'a AccountHttpState,
    context: &ActorContext,
) -> Result<&'a UploadService, ApiFailure> {
    state.media.as_ref().ok_or_else(|| context.request.failure(AccountError::Unavailable))
}

async fn admit_mutation(
    state: &AccountHttpState,
    context: &ActorContext,
) -> Result<(), ApiFailure> {
    let user_id = context.actor.user_id.to_string();
    state.limiter.admit_media(&user_id).await.map_err(|error| context.request.failure(error))
}

#[utoipa::path(
    post, path = "/api/v1/media/uploads", request_body = ReserveUpload,
    responses((status = 200, body = UploadStatus))
)]
async fn reserve(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(request): SafeJson<ReserveUpload>,
) -> Result<Json<UploadStatus>, ApiFailure> {
    let uploads = uploads(&state, &context)?;
    admit_mutation(&state, &context).await?;
    let result = uploads.reserve(&context.actor, request).await;

    result.map(Json).map_err(|error| context.request.failure(error))
}

#[utoipa::path(
    get, path = "/api/v1/media/uploads/{upload_id}", params(("upload_id" = Uuid, Path)),
    responses((status = 200, body = UploadStatus))
)]
async fn status(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(upload_id): Path<Uuid>,
) -> Result<Json<UploadStatus>, ApiFailure> {
    let uploads = uploads(&state, &context)?;
    let result = uploads.status(&context.actor, upload_id).await;

    result.map(Json).map_err(|error| context.request.failure(error))
}

#[utoipa::path(
    post, path = "/api/v1/media/uploads/{upload_id}/transfer",
    params(("upload_id" = Uuid, Path)), request_body = TransferRequest,
    responses((status = 200, body = TransferPlan))
)]
async fn transfer(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(upload_id): Path<Uuid>,
    SafeJson(request): SafeJson<TransferRequest>,
) -> Result<Json<TransferPlan>, ApiFailure> {
    let uploads = uploads(&state, &context)?;
    admit_mutation(&state, &context).await?;
    let result = uploads.transfer(&context.actor, upload_id, request.part_numbers).await;

    result.map(Json).map_err(|error| context.request.failure(error))
}

#[utoipa::path(
    post, path = "/api/v1/media/uploads/{upload_id}/complete", params(("upload_id" = Uuid, Path)),
    responses((status = 200, body = UploadStatus))
)]
async fn complete(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(upload_id): Path<Uuid>,
) -> Result<Json<UploadStatus>, ApiFailure> {
    let uploads = uploads(&state, &context)?;
    admit_mutation(&state, &context).await?;
    let result = uploads.complete(&context.actor, upload_id).await;

    result.map(Json).map_err(|error| context.request.failure(error))
}

#[utoipa::path(
    delete, path = "/api/v1/media/uploads/{upload_id}", params(("upload_id" = Uuid, Path)),
    responses((status = 200, body = UploadStatus))
)]
async fn cancel(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(upload_id): Path<Uuid>,
) -> Result<Json<UploadStatus>, ApiFailure> {
    let uploads = uploads(&state, &context)?;
    admit_mutation(&state, &context).await?;
    let result = uploads.cancel(&context.actor, upload_id).await;

    result.map(Json).map_err(|error| context.request.failure(error))
}

/// Mount upload commands under the existing authenticated account transport.
pub(crate) fn router() -> Router<AccountHttpState> {
    let routes = Router::new()
        .route("/media/uploads", post(reserve))
        .route("/media/uploads/{upload_id}", get(status).delete(cancel));
    routes
        .route("/media/uploads/{upload_id}/transfer", post(transfer))
        .route("/media/uploads/{upload_id}/complete", post(complete))
}
