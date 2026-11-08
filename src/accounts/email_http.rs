use axum::{
    Router,
    extract::State,
    http::StatusCode,
    routing::{delete, post},
};
use serde::Deserialize;
use utoipa::{OpenApi, ToSchema};

use super::{
    email::PasswordReset,
    extractors::{ActorContext, ApiFailure, PublicContext, SafeJson},
    http::AccountHttpState,
};

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct EmailAddress {
    email: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct EmailConfirmation {
    token: String,
}

#[derive(OpenApi)]
#[openapi(paths(request_verification, confirm, remove, request_recovery, reset_password))]
pub(crate) struct EmailDocument;

#[utoipa::path(
    post,
    path = "/api/v1/account/email/verification",
    request_body = EmailAddress,
    responses((status = 202))
)]
async fn request_verification(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<EmailAddress>,
) -> Result<StatusCode, ApiFailure> {
    state
        .limiter
        .admit("email", &context.request.client, &context.actor.user_id.to_string())
        .await
        .map_err(|error| context.request.failure(error))?;
    state
        .email
        .request_verification(&context.actor, input.email)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(StatusCode::ACCEPTED)
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/email/confirm",
    request_body = EmailConfirmation,
    responses((status = 204))
)]
async fn confirm(
    State(state): State<AccountHttpState>,
    context: PublicContext,
    SafeJson(input): SafeJson<EmailConfirmation>,
) -> Result<StatusCode, ApiFailure> {
    state
        .limiter
        .admit("email-confirm", &context.client, &input.token)
        .await
        .map_err(|error| context.failure(error))?;
    state.email.confirm(input.token).await.map_err(|error| context.failure(error))?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete,
    path = "/api/v1/account/email",
    responses((status = 204))
)]
async fn remove(
    State(state): State<AccountHttpState>,
    context: ActorContext,
) -> Result<StatusCode, ApiFailure> {
    state.email.remove(&context.actor).await.map_err(|error| context.request.failure(error))?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/recovery",
    request_body = EmailAddress,
    responses((status = 202))
)]
async fn request_recovery(
    State(state): State<AccountHttpState>,
    context: PublicContext,
    SafeJson(input): SafeJson<EmailAddress>,
) -> Result<StatusCode, ApiFailure> {
    let identity = input.email.trim().to_ascii_lowercase();
    state
        .limiter
        .admit("recovery", &context.client, &identity)
        .await
        .map_err(|error| context.failure(error))?;
    state.email.request_recovery(input.email).await.map_err(|error| context.failure(error))?;

    Ok(StatusCode::ACCEPTED)
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/recovery/reset",
    request_body = PasswordReset,
    responses((status = 204))
)]
async fn reset_password(
    State(state): State<AccountHttpState>,
    context: PublicContext,
    SafeJson(input): SafeJson<PasswordReset>,
) -> Result<StatusCode, ApiFailure> {
    state
        .limiter
        .admit("recovery-reset", &context.client, &input.token)
        .await
        .map_err(|error| context.failure(error))?;
    state.email.reset_password(input).await.map_err(|error| context.failure(error))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Route email ownership and recovery through the same Origin, CSRF, and admission boundaries.
pub(crate) fn router() -> Router<AccountHttpState> {
    let routes = Router::new().route("/account/email/verification", post(request_verification));
    let routes =
        routes.route("/account/email", delete(remove)).route("/auth/email/confirm", post(confirm));

    routes
        .route("/auth/recovery", post(request_recovery))
        .route("/auth/recovery/reset", post(reset_password))
}
