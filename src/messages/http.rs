use crate::accounts::AccountError;
use axum::http::request::Parts;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRequestParts, Path, State},
    routing::{get, post},
};
use utoipa::OpenApi;
use uuid::Uuid;

use super::{
    CanonicalMessage, HistoryPage, HistoryQuery, MessageService, SendMessage, SendReceipt,
};
use crate::{
    accounts::{
        extractors::{ActorContext, ApiFailure, SafeJson, SafeQuery},
        http::AccountHttpState,
    },
    sync::{Bootstrap, SyncPage, SyncQuery},
};

const MAX_MESSAGE_BODY_BYTES: usize = 128 * 1024;

#[derive(OpenApi)]
#[openapi(paths(bootstrap, sync, send, message, history))]
pub struct MessageDocument;

#[utoipa::path(
    get, path = "/api/v1/chat/bootstrap",
    responses((status = 200, body = Bootstrap))
)]
async fn bootstrap(
    State(state): State<AccountHttpState>,
    context: ActorContext,
) -> Result<Json<Bootstrap>, ApiFailure> {
    let snapshot = MessageService::new(state.accounts)
        .bootstrap(context.actor)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(snapshot))
}

#[utoipa::path(
    get, path = "/api/v1/chat/sync", params(SyncQuery),
    responses((status = 200, body = SyncPage))
)]
async fn sync(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeQuery(query): SafeQuery<SyncQuery>,
) -> Result<Json<SyncPage>, ApiFailure> {
    let page = MessageService::new(state.accounts)
        .sync(context.actor, query)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(page))
}

#[utoipa::path(
    post, path = "/api/v1/messages", request_body = SendMessage,
    responses((status = 200, body = SendReceipt))
)]
async fn send(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<SendMessage>,
) -> Result<Json<SendReceipt>, ApiFailure> {
    state
        .limiter
        .admit_message(&context.actor.user_id.to_string())
        .await
        .map_err(|error| context.request.failure(error))?;
    let receipt = MessageService::new(state.accounts)
        .send(context.actor, input)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(receipt))
}

#[utoipa::path(
    get, path = "/api/v1/messages/{message_id}", params(("message_id" = Uuid, Path)),
    responses((status = 200, body = CanonicalMessage))
)]
async fn message(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(message_id): Path<Uuid>,
) -> Result<Json<CanonicalMessage>, ApiFailure> {
    let message = MessageService::new(state.accounts)
        .message(context.actor, message_id)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(message))
}

struct HistoryRequest {
    context: ActorContext,
    conversation_id: Uuid,
    query: HistoryQuery,
}

impl FromRequestParts<AccountHttpState> for HistoryRequest {
    type Rejection = ApiFailure;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AccountHttpState,
    ) -> Result<Self, Self::Rejection> {
        let context = ActorContext::from_request_parts(parts, state).await?;
        let Path(conversation_id) = Path::from_request_parts(parts, state).await.map_err(|_| {
            context.request.failure(AccountError::Validation("invalid conversation ID"))
        })?;
        let SafeQuery(query) = SafeQuery::from_request_parts(parts, state).await?;

        Ok(Self {
            context,
            conversation_id,
            query,
        })
    }
}
#[utoipa::path(
    get, path = "/api/v1/conversations/{conversation_id}/history",
    params(("conversation_id" = Uuid, Path), HistoryQuery),
    responses((status = 200, body = HistoryPage))
)]
async fn history(
    State(state): State<AccountHttpState>,
    input: HistoryRequest,
) -> Result<Json<HistoryPage>, ApiFailure> {
    let HistoryRequest {
        context,
        conversation_id,
        mut query,
    } = input;
    query.conversation_id = conversation_id;
    let page = MessageService::new(state.accounts)
        .history(context.actor, query)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(page))
}

/// Attach messaging routes to the existing cookie, CSRF, Origin, and no-store boundaries.
pub(crate) fn router() -> Router<AccountHttpState> {
    let routes =
        Router::new().route("/chat/bootstrap", get(bootstrap)).route("/chat/sync", get(sync));
    let routes =
        routes.route("/messages", post(send)).route("/messages/{message_id}", get(message));
    routes
        .route("/conversations/{conversation_id}/history", get(history))
        .layer(DefaultBodyLimit::max(MAX_MESSAGE_BODY_BYTES))
}
