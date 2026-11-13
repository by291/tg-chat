//! Authenticated HTTP boundary for private media credentials.

use axum::{
    Json, Router,
    extract::{Path, State},
    routing::post,
};
use utoipa::OpenApi;
use uuid::Uuid;

use crate::features::accounts::{
    AccountError,
    extractors::{ActorContext, ApiFailure},
    http::AccountHttpState,
};

use super::livekit::RoomCredentials;

#[derive(OpenApi)]
#[openapi(paths(credentials), components(schemas(RoomCredentials)))]
pub(crate) struct CredentialDocument;

/// Mount the designated session's room credential endpoint.
pub(crate) fn router() -> Router<AccountHttpState> {
    Router::new().route("/calls/{call_id}/credentials", post(credentials))
}

#[utoipa::path(
    post,
    path = "/api/v1/calls/{call_id}/credentials",
    params(("call_id" = Uuid, Path, description = "The call identity")),
    responses((status = 200, body = RoomCredentials))
)]
async fn credentials(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(call_id): Path<Uuid>,
) -> Result<Json<RoomCredentials>, ApiFailure> {
    let rooms = state.call_rooms.as_ref();
    let rooms = rooms.ok_or_else(|| context.request.failure(AccountError::CallNotAllowed))?;
    let response = rooms.credentials(&context.actor, call_id).await;

    response.map(Json).map_err(|error| context.request.failure(error))
}
