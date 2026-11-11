use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
};
use utoipa::OpenApi;
use uuid::Uuid;

use super::activity::{ActivityHeartbeat, ActivityPresence, ActivityPresenceQuery, ActivityTyping};
use crate::accounts::{
    extractors::{ActorContext, ApiFailure, SafeJson, SafeQuery},
    http::AccountHttpState,
};

#[derive(OpenApi)]
#[openapi(paths(heartbeat, presence, typing))]
pub(crate) struct ActivityDocument;

#[utoipa::path(
    post,
    path = "/api/v1/activity/heartbeat",
    request_body = ActivityHeartbeat,
    responses((status = 204), (status = 503))
)]
async fn heartbeat(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<ActivityHeartbeat>,
) -> Result<StatusCode, ApiFailure> {
    let result = state.activity.heartbeat(&context.actor, input).await;
    result.map_err(|error| context.request.failure(error))?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/activity/presence/{user_id}",
    params(("user_id" = Uuid, Path), ActivityPresenceQuery),
    responses((status = 200, body = ActivityPresence), (status = 404), (status = 503))
)]
async fn presence(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(user_id): Path<Uuid>,
    SafeQuery(query): SafeQuery<ActivityPresenceQuery>,
) -> Result<Json<ActivityPresence>, ApiFailure> {
    let result = state.activity.presence(&context.actor, user_id, query).await;
    let presence = result.map_err(|error| context.request.failure(error))?;

    Ok(Json(presence))
}

#[utoipa::path(
    post,
    path = "/api/v1/conversations/{conversation_id}/typing",
    params(("conversation_id" = Uuid, Path)),
    request_body = ActivityTyping,
    responses((status = 204), (status = 404), (status = 503))
)]
async fn typing(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(conversation_id): Path<Uuid>,
    SafeJson(input): SafeJson<ActivityTyping>,
) -> Result<StatusCode, ApiFailure> {
    let result = state.activity.typing(&context.actor, conversation_id, input).await;
    result.map_err(|error| context.request.failure(error))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Add authenticated, non-cacheable activity routes to the shared account transport.
pub(crate) fn router() -> Router<AccountHttpState> {
    Router::new()
        .route("/activity/heartbeat", post(heartbeat))
        .route("/activity/presence/{user_id}", get(presence))
        .route("/conversations/{conversation_id}/typing", post(typing))
}
