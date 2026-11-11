use axum::{Router, extract::State, http::StatusCode, routing::post};
use utoipa::OpenApi;

use super::OperatorCommand;
use crate::accounts::{
    extractors::{ActorContext, ApiFailure, SafeJson},
    http::AccountHttpState,
};

#[derive(OpenApi)]
#[openapi(paths(operator_command))]
pub(crate) struct ModerationDocument;

#[utoipa::path(
    post,
    path = "/api/v1/operator/commands",
    request_body = OperatorCommand,
    responses(
        (status = 204, description = "Operator command committed or already applied"),
        (status = 400, body = crate::http::ErrorResponse),
        (status = 401, body = crate::http::ErrorResponse),
        (status = 403, body = crate::http::ErrorResponse),
        (status = 404, body = crate::http::ErrorResponse),
        (status = 409, body = crate::http::ErrorResponse)
    )
)]
async fn operator_command(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<OperatorCommand>,
) -> Result<StatusCode, ApiFailure> {
    state
        .accounts
        .submit_operator_command(&context.actor, input)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Build the authenticated, CSRF-protected operator command routes.
pub(crate) fn router() -> Router<AccountHttpState> {
    Router::new().route("/operator/commands", post(operator_command))
}
