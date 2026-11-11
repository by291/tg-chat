use axum::{Json, Router, extract::State, routing::get};
use utoipa::OpenApi;

use super::{
    extractors::{ActorContext, ApiFailure, SafeJson},
    http::AccountHttpState,
    preferences::{AccountPreferenceChanges, AccountPreferences},
};

#[derive(OpenApi)]
#[openapi(paths(account_preferences, update_account_preferences))]
pub(crate) struct PreferencesDocument;

#[utoipa::path(
    get,
    path = "/api/v1/account/preferences",
    responses(
        (status = 200, body = AccountPreferences),
        (status = 401, body = crate::http::ErrorResponse)
    )
)]
async fn account_preferences(
    State(state): State<AccountHttpState>,
    context: ActorContext,
) -> Result<Json<AccountPreferences>, ApiFailure> {
    let preferences = state
        .accounts
        .preferences(&context.actor)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(preferences))
}

#[utoipa::path(
    patch,
    path = "/api/v1/account/preferences",
    request_body = AccountPreferenceChanges,
    responses(
        (status = 200, body = AccountPreferences),
        (status = 400, body = crate::http::ErrorResponse),
        (status = 401, body = crate::http::ErrorResponse),
        (status = 403, body = crate::http::ErrorResponse),
        (status = 409, body = crate::http::ErrorResponse)
    )
)]
async fn update_account_preferences(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<AccountPreferenceChanges>,
) -> Result<Json<AccountPreferences>, ApiFailure> {
    let preferences = state
        .accounts
        .update_preferences(&context.actor, input)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(preferences))
}

/// Build session-owned account preference routes.
pub(crate) fn router() -> Router<AccountHttpState> {
    Router::new()
        .route("/account/preferences", get(account_preferences).patch(update_account_preferences))
}
