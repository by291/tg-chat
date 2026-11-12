use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

use super::{CallAction, CallCommand, CallEndReason, CallService, CallView, StartCall};
use crate::accounts::{
    AccountError,
    extractors::{ActorContext, ApiFailure, SafeJson},
    http::AccountHttpState,
};

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct CallCommandBody {
    operation_id: Uuid,
    action: CallAction,
}

#[derive(Serialize, ToSchema)]
struct CurrentCall {
    call: Option<CallView>,
}

#[derive(Serialize, ToSchema)]
struct CallOutcome {
    end_reason: Option<CallEndReason>,
}

#[derive(OpenApi)]
#[openapi(paths(start_call, command_call, current_call, call_outcome))]
pub(crate) struct CallDocument;

/// Mount the authenticated call API within the account transport and cache boundaries.
pub(crate) fn router() -> Router<AccountHttpState> {
    let router = Router::new().route("/calls", post(start_call));
    let router = router.route("/calls/{call_id}/commands", post(command_call));
    router
        .route("/calls/current", get(current_call))
        .route("/calls/{call_id}/outcome", get(call_outcome))
}

#[utoipa::path(
    post,
    path = "/api/v1/calls",
    request_body = StartCall,
    responses((status = 200, body = CallView))
)]
async fn start_call(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<StartCall>,
) -> Result<Json<CallView>, ApiFailure> {
    let calls = require_calls(&state, &context)?;
    let caller = context.actor.user_id.to_string();
    state
        .limiter
        .admit("call_start", &context.request.client, &caller)
        .await
        .map_err(|error| context.request.failure(error))?;

    let result = calls.start(&context.actor, input).await;
    result.map(Json).map_err(|error| context.request.failure(error))
}

#[utoipa::path(
    post,
    path = "/api/v1/calls/{call_id}/commands",
    params(("call_id" = Uuid, Path, description = "The call identity")),
    request_body = CallCommandBody,
    responses((status = 200, body = CallView))
)]
async fn command_call(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(call_id): Path<Uuid>,
    SafeJson(input): SafeJson<CallCommandBody>,
) -> Result<Json<CallView>, ApiFailure> {
    let calls = require_calls(&state, &context)?;
    let command = CallCommand {
        call_id,
        operation_id: input.operation_id,
        action: input.action,
    };

    let result = calls.command(&context.actor, command).await;
    result.map(Json).map_err(|error| context.request.failure(error))
}

#[utoipa::path(
    get,
    path = "/api/v1/calls/current",
    responses((status = 200, body = CurrentCall))
)]
async fn current_call(
    State(state): State<AccountHttpState>,
    context: ActorContext,
) -> Result<Json<CurrentCall>, ApiFailure> {
    let Some(calls) = &state.calls else {
        return Ok(Json(CurrentCall {
            call: None,
        }));
    };

    let result = calls.current(&context.actor).await;
    let call = result.map_err(|error| context.request.failure(error))?;

    Ok(Json(CurrentCall {
        call,
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/calls/{call_id}/outcome",
    params(("call_id" = Uuid, Path, description = "The call identity")),
    responses((status = 200, body = CallOutcome))
)]
async fn call_outcome(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(call_id): Path<Uuid>,
) -> Result<Json<CallOutcome>, ApiFailure> {
    let calls = require_calls(&state, &context)?;
    let result = calls.outcome(&context.actor, call_id).await;
    let end_reason = result.map_err(|error| context.request.failure(error))?;

    Ok(Json(CallOutcome {
        end_reason,
    }))
}

fn require_calls<'a>(
    state: &'a AccountHttpState,
    context: &ActorContext,
) -> Result<&'a CallService, ApiFailure> {
    state.calls.as_ref().ok_or_else(|| context.request.failure(AccountError::CallNotAllowed))
}
