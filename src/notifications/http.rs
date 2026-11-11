use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, put},
};
use utoipa::OpenApi;

use super::{
    NotificationIdentity, PushCapability, PushPayload, PushSubscriptionInput,
    PushSubscriptionReceipt,
};
use crate::accounts::{
    AccountError,
    extractors::{ActorContext, ApiFailure, SafeJson},
    http::AccountHttpState,
};

#[derive(OpenApi)]
#[openapi(
    paths(capability, subscribe, unsubscribe),
    components(schemas(NotificationIdentity, PushPayload))
)]
pub(crate) struct NotificationDocument;

#[utoipa::path(
    get, path = "/api/v1/notifications/capability",
    responses((status = 200, body = PushCapability))
)]
async fn capability(
    State(state): State<AccountHttpState>,
    _: ActorContext,
) -> Json<PushCapability> {
    let capability = state.notifications.as_ref().map(|service| service.capability());
    Json(capability.unwrap_or_default())
}

#[utoipa::path(
    put, path = "/api/v1/notifications/subscription", request_body = PushSubscriptionInput,
    responses((status = 200, body = PushSubscriptionReceipt))
)]
async fn subscribe(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<PushSubscriptionInput>,
) -> Result<Json<PushSubscriptionReceipt>, ApiFailure> {
    let service = state
        .notifications
        .as_ref()
        .ok_or_else(|| context.request.failure(AccountError::Unavailable))?;
    let receipt = service
        .subscribe(&context.actor, input)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(receipt))
}

#[utoipa::path(
    delete, path = "/api/v1/notifications/subscription",
    responses((status = 204, description = "The session subscription was removed"))
)]
async fn unsubscribe(
    State(state): State<AccountHttpState>,
    context: ActorContext,
) -> Result<StatusCode, ApiFailure> {
    state
        .accounts
        .remove_push_subscription(&context.actor)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn routes() -> Router<AccountHttpState> {
    let router = Router::new().route("/notifications/capability", get(capability));
    router.route("/notifications/subscription", put(subscribe).delete(unsubscribe))
}
