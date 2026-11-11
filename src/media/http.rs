use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post, put},
};
use utoipa::OpenApi;
use uuid::Uuid;

use crate::accounts::{
    AccountError,
    extractors::{ActorContext, ApiFailure, SafeJson},
    http::AccountHttpState,
};

use super::{
    AvatarDownload, AvatarOwner, DownloadReference, MediaVariant, MessageDownload, ReserveUpload,
    SetAvatar, SignedDownload, TransferPlan, TransferRequest, UploadService, UploadStatus,
};

#[derive(OpenApi)]
#[openapi(
    paths(
        reserve,
        status,
        transfer,
        complete,
        cancel,
        download_message,
        download_avatar,
        preview_upload,
        set_profile_avatar
    ),
    components(schemas(AvatarOwner, MediaVariant))
)]
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

async fn authorize_download(
    state: &AccountHttpState,
    context: &ActorContext,
    reference: DownloadReference,
) -> Result<Json<SignedDownload>, ApiFailure> {
    let uploads = uploads(state, context)?;
    let result = uploads.sign_download(&context.actor, reference).await;

    result.map(Json).map_err(|error| context.request.failure(error))
}

#[utoipa::path(
    get, path = "/api/v1/media/messages/{message_id}/attachments/{occurrence_id}/{variant}",
    params(
        ("message_id" = Uuid, Path),
        ("occurrence_id" = Uuid, Path),
        ("variant" = MediaVariant, Path)
    ),
    responses((status = 200, body = SignedDownload))
)]
async fn download_message(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path((message_id, occurrence_id, variant)): Path<(Uuid, Uuid, MediaVariant)>,
) -> Result<Json<SignedDownload>, ApiFailure> {
    let reference = DownloadReference::Message(MessageDownload {
        message_id,
        occurrence_id,
        variant,
    });
    authorize_download(&state, &context, reference).await
}

#[utoipa::path(
    get, path = "/api/v1/media/avatars/{owner_kind}/{owner_id}/{variant}",
    params(
        ("owner_kind" = AvatarOwner, Path),
        ("owner_id" = Uuid, Path),
        ("variant" = MediaVariant, Path)
    ),
    responses((status = 200, body = SignedDownload))
)]
async fn download_avatar(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path((owner, owner_id, variant)): Path<(AvatarOwner, Uuid, MediaVariant)>,
) -> Result<Json<SignedDownload>, ApiFailure> {
    let reference = DownloadReference::Avatar(AvatarDownload {
        owner,
        owner_id,
        variant,
    });
    authorize_download(&state, &context, reference).await
}

#[utoipa::path(
    get, path = "/api/v1/media/uploads/{upload_id}/preview/{variant}",
    params(("upload_id" = Uuid, Path), ("variant" = MediaVariant, Path)),
    responses((status = 200, body = SignedDownload))
)]
async fn preview_upload(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path((upload_id, variant)): Path<(Uuid, MediaVariant)>,
) -> Result<Json<SignedDownload>, ApiFailure> {
    let reference = DownloadReference::Upload {
        upload_id,
        variant,
    };
    authorize_download(&state, &context, reference).await
}

#[utoipa::path(
    put, path = "/api/v1/account/profile/avatar", request_body = SetAvatar,
    responses((status = 200, body = crate::accounts::PrivateProfile))
)]
async fn set_profile_avatar(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<SetAvatar>,
) -> Result<Json<crate::accounts::PrivateProfile>, ApiFailure> {
    uploads(&state, &context)?;
    admit_mutation(&state, &context).await?;
    let result = state.accounts.set_avatar(&context.actor, input).await;

    result.map(Json).map_err(|error| context.request.failure(error))
}

/// Mount upload commands under the existing authenticated account transport.
pub(crate) fn router() -> Router<AccountHttpState> {
    let routes = Router::new()
        .route("/media/uploads", post(reserve))
        .route("/media/uploads/{upload_id}", get(status).delete(cancel));
    let routes = routes
        .route("/media/uploads/{upload_id}/transfer", post(transfer))
        .route("/media/uploads/{upload_id}/complete", post(complete));
    let routes = routes.route(
        "/media/messages/{message_id}/attachments/{occurrence_id}/{variant}",
        get(download_message),
    );
    routes
        .route("/media/avatars/{owner_kind}/{owner_id}/{variant}", get(download_avatar))
        .route("/media/uploads/{upload_id}/preview/{variant}", get(preview_upload))
        .route("/account/profile/avatar", put(set_profile_avatar))
}
