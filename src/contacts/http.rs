use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, patch},
};
use serde::Deserialize;
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

use super::{DirectoryPage, DirectoryQuery, PrivacySettings, RelationshipChange};
use crate::accounts::{
    PrivateProfile,
    extractors::{ActorContext, ApiFailure, SafeJson, SafeQuery},
    http::AccountHttpState,
    profile::ProfileUpdate,
};

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct RelationshipTarget {
    target_id: Uuid,
}

#[derive(OpenApi)]
#[openapi(paths(
    update_profile,
    privacy,
    update_privacy,
    discover,
    contacts,
    blocks,
    add_contact,
    remove_contact,
    add_block,
    remove_block
))]
pub(crate) struct ContactDocument;

#[utoipa::path(
    patch,
    path = "/api/v1/account/profile",
    request_body = ProfileUpdate,
    responses((status = 200, body = PrivateProfile))
)]
async fn update_profile(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<ProfileUpdate>,
) -> Result<Json<PrivateProfile>, ApiFailure> {
    let profile = state
        .accounts
        .update_profile(&context.actor, input)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(profile))
}

#[utoipa::path(
    get,
    path = "/api/v1/account/privacy",
    responses((status = 200, body = PrivacySettings))
)]
async fn privacy(
    State(state): State<AccountHttpState>,
    context: ActorContext,
) -> Result<Json<PrivacySettings>, ApiFailure> {
    let privacy = state
        .accounts
        .privacy(&context.actor)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(privacy))
}

#[utoipa::path(
    patch,
    path = "/api/v1/account/privacy",
    request_body = PrivacySettings,
    responses((status = 200, body = PrivacySettings))
)]
async fn update_privacy(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<PrivacySettings>,
) -> Result<Json<PrivacySettings>, ApiFailure> {
    let privacy = state
        .accounts
        .update_privacy(&context.actor, input)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(privacy))
}

#[utoipa::path(
    get,
    path = "/api/v1/users",
    params(DirectoryQuery),
    responses((status = 200, body = DirectoryPage))
)]
async fn discover(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeQuery(query): SafeQuery<DirectoryQuery>,
) -> Result<Json<DirectoryPage>, ApiFailure> {
    state
        .limiter
        .admit("discovery", &context.request.client, &context.actor.user_id.to_string())
        .await
        .map_err(|error| context.request.failure(error))?;
    let page = state
        .accounts
        .discover(&context.actor, query)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(page))
}

#[utoipa::path(
    get,
    path = "/api/v1/contacts",
    params(DirectoryQuery),
    responses((status = 200, body = DirectoryPage))
)]
async fn contacts(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeQuery(query): SafeQuery<DirectoryQuery>,
) -> Result<Json<DirectoryPage>, ApiFailure> {
    let page = state
        .accounts
        .contacts(&context.actor, query)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(page))
}

#[utoipa::path(
    get,
    path = "/api/v1/blocks",
    params(DirectoryQuery),
    responses((status = 200, body = DirectoryPage))
)]
async fn blocks(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeQuery(query): SafeQuery<DirectoryQuery>,
) -> Result<Json<DirectoryPage>, ApiFailure> {
    let page = state
        .accounts
        .blocks(&context.actor, query)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(Json(page))
}

#[utoipa::path(
    put,
    path = "/api/v1/contacts",
    request_body = RelationshipTarget,
    responses((status = 204))
)]
async fn add_contact(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<RelationshipTarget>,
) -> Result<StatusCode, ApiFailure> {
    state
        .accounts
        .add_contact(RelationshipChange {
            actor: context.actor.clone(),
            target_id: input.target_id,
        })
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete,
    path = "/api/v1/contacts",
    request_body = RelationshipTarget,
    responses((status = 204))
)]
async fn remove_contact(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<RelationshipTarget>,
) -> Result<StatusCode, ApiFailure> {
    state
        .accounts
        .remove_contact(RelationshipChange {
            actor: context.actor.clone(),
            target_id: input.target_id,
        })
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    put,
    path = "/api/v1/blocks",
    request_body = RelationshipTarget,
    responses((status = 204))
)]
async fn add_block(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<RelationshipTarget>,
) -> Result<StatusCode, ApiFailure> {
    state
        .accounts
        .add_block(RelationshipChange {
            actor: context.actor.clone(),
            target_id: input.target_id,
        })
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete,
    path = "/api/v1/blocks",
    request_body = RelationshipTarget,
    responses((status = 204))
)]
async fn remove_block(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<RelationshipTarget>,
) -> Result<StatusCode, ApiFailure> {
    state
        .accounts
        .remove_block(RelationshipChange {
            actor: context.actor.clone(),
            target_id: input.target_id,
        })
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Add relationship and account preference routes under the shared authenticated transport.
pub(crate) fn router() -> Router<AccountHttpState> {
    let routes = Router::new()
        .route("/account/profile", patch(update_profile))
        .route("/account/privacy", get(privacy).patch(update_privacy));
    let routes = routes.route("/users", get(discover));
    let routes = routes.route("/contacts", get(contacts).put(add_contact).delete(remove_contact));

    routes.route("/blocks", get(blocks).put(add_block).delete(remove_block))
}
