use crate::accounts::AccountError;
use axum::http::request::Parts;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRequestParts, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use utoipa::OpenApi;
use uuid::Uuid;

use super::{
    CanonicalMessage, CommandReceipt, ForwardBatch, ForwardReceipt, HistoryPage, HistoryQuery,
    MessageCommand, MessageKind, MessageReadTime, MessageService, SearchPage, SearchQuery,
    SendMessage, SendReceipt,
    polls::{PollVoterPage, PollVoterQuery},
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
#[openapi(
    paths(
        bootstrap,
        sync,
        search,
        send,
        forward,
        message,
        read_time,
        poll_voters,
        history,
        command
    ),
    components(schemas(MessageKind))
)]
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
    get, path = "/api/v1/chat/search", params(SearchQuery),
    responses((status = 200, body = SearchPage))
)]
async fn search(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeQuery(query): SafeQuery<SearchQuery>,
) -> Result<Json<SearchPage>, ApiFailure> {
    let page = MessageService::new(state.accounts)
        .search(context.actor, query)
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
    post, path = "/api/v1/messages/forward", request_body = ForwardBatch,
    responses((status = 200, body = ForwardReceipt))
)]
async fn forward(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<ForwardBatch>,
) -> Result<Json<ForwardReceipt>, ApiFailure> {
    state
        .limiter
        .admit_message(&context.actor.user_id.to_string())
        .await
        .map_err(|error| context.request.failure(error))?;
    let receipt = MessageService::new(state.accounts)
        .forward(context.actor, input)
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

#[utoipa::path(
    get, path = "/api/v1/messages/{message_id}/read-time",
    params(("message_id" = Uuid, Path)),
    responses((status = 200, body = MessageReadTime), (status = 404))
)]
async fn read_time(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(message_id): Path<Uuid>,
) -> Result<Json<MessageReadTime>, ApiFailure> {
    let read_time = MessageService::new(state.accounts)
        .read_time(context.actor, message_id)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(read_time))
}

#[utoipa::path(
    get, path = "/api/v1/messages/{message_id}/poll/voters",
    params(("message_id" = Uuid, Path), PollVoterQuery),
    responses((status = 200, body = PollVoterPage))
)]
async fn poll_voters(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(message_id): Path<Uuid>,
    SafeQuery(query): SafeQuery<PollVoterQuery>,
) -> Result<Json<PollVoterPage>, ApiFailure> {
    let page = MessageService::new(state.accounts)
        .poll_voters(context.actor, message_id, query)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(page))
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

#[derive(serde::Serialize, utoipa::ToSchema)]
struct CommandConflict {
    error: crate::http::ErrorDetails,
    current: CommandReceipt,
}

#[utoipa::path(
    post, path = "/api/v1/chat/commands", request_body = MessageCommand,
    responses((status = 200, body = CommandReceipt), (status = 409, body = CommandConflict))
)]
async fn command(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<MessageCommand>,
) -> Result<Response, ApiFailure> {
    state
        .limiter
        .admit_message(&context.actor.user_id.to_string())
        .await
        .map_err(|error| context.request.failure(error))?;
    let service = MessageService::new(state.accounts);
    match service.command(context.actor.clone(), input.clone()).await {
        Ok(receipt) => Ok(Json(receipt).into_response()),
        Err(AccountError::MessageConflict) => {
            let current = service
                .command_snapshot(context.actor, &input)
                .await
                .map_err(|error| context.request.failure(error))?;
            let conflict = CommandConflict {
                error: crate::http::ErrorDetails {
                    code: "message_conflict",
                    message: "The resource changed; reconcile its current version".to_owned(),
                    request_id: context.request.request_id,
                },
                current,
            };
            Ok((StatusCode::CONFLICT, Json(conflict)).into_response())
        }
        Err(error) => Err(context.request.failure(error)),
    }
}

/// Attach messaging routes to the existing cookie, CSRF, Origin, and no-store boundaries.
pub(crate) fn router() -> Router<AccountHttpState> {
    let routes =
        Router::new().route("/chat/bootstrap", get(bootstrap)).route("/chat/sync", get(sync));
    let routes =
        routes.route("/messages", post(send)).route("/messages/{message_id}", get(message));
    routes
        .route("/chat/commands", post(command))
        .route("/chat/search", get(search))
        .route("/messages/forward", post(forward))
        .route("/messages/{message_id}/read-time", get(read_time))
        .route("/messages/{message_id}/poll/voters", get(poll_voters))
        .route("/conversations/{conversation_id}/history", get(history))
        .layer(DefaultBodyLimit::max(MAX_MESSAGE_BODY_BYTES))
}
