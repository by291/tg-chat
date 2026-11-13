use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    routing::{get, post},
};
use serde::Deserialize;
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

use super::{
    CommunityCommand, CommunityDiscoveryKind, CommunityDiscoveryQuery, CommunityListQuery,
    CommunityMemberPage, CommunityPage, CommunityPageQuery, ConversationView, CreateCommunity,
    InvitationPage, InvitationQuery, InvitePreview, JoinRequestPage,
};
use crate::features::{
    accounts::{
        extractors::{ActorContext, ApiFailure, SafeJson, SafeQuery},
        http::AccountHttpState,
    },
    messages::{CommandReceipt, MessageService},
};

const MAX_COMMUNITY_BODY_BYTES: usize = 16 * 1024;

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InvitePreviewInput {
    pub token: String,
}

#[derive(OpenApi)]
#[openapi(
    components(schemas(CommunityDiscoveryKind)),
    paths(discover, create, details, command, members, requests, invitations, inbox, preview)
)]
pub struct CommunityDocument;

#[utoipa::path(operation_id = "community_discover", get, path = "/api/v1/communities", params(CommunityDiscoveryQuery),
    responses((status = 200, body = CommunityPage)))]
async fn discover(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeQuery(query): SafeQuery<CommunityDiscoveryQuery>,
) -> Result<Json<CommunityPage>, ApiFailure> {
    let page = MessageService::new(state.accounts)
        .discover_communities(context.actor, query)
        .await
        .map_err(|error| context.request.failure(error))?;
    Ok(Json(page))
}

#[utoipa::path(operation_id = "community_create", post, path = "/api/v1/communities", request_body = CreateCommunity,
    responses((status = 200, body = CommandReceipt)))]
async fn create(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<CreateCommunity>,
) -> Result<Json<CommandReceipt>, ApiFailure> {
    state
        .limiter
        .admit_message(&context.actor.user_id.to_string())
        .await
        .map_err(|error| context.request.failure(error))?;
    let receipt = MessageService::new(state.accounts)
        .create_community(context.actor, input)
        .await
        .map_err(|error| context.request.failure(error))?;
    Ok(Json(receipt))
}

#[utoipa::path(operation_id = "community_details", get, path = "/api/v1/communities/{conversation_id}",
    params(("conversation_id" = Uuid, Path)), responses((status = 200, body = ConversationView)))]
async fn details(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(conversation_id): Path<Uuid>,
) -> Result<Json<ConversationView>, ApiFailure> {
    let view = MessageService::new(state.accounts)
        .community_details(context.actor, conversation_id)
        .await
        .map_err(|error| context.request.failure(error))?;
    Ok(Json(view))
}

#[utoipa::path(operation_id = "community_command", post, path = "/api/v1/communities/commands", request_body = CommunityCommand,
    responses((status = 200, body = CommandReceipt)))]
async fn command(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<CommunityCommand>,
) -> Result<Json<CommandReceipt>, ApiFailure> {
    state
        .limiter
        .admit_message(&context.actor.user_id.to_string())
        .await
        .map_err(|error| context.request.failure(error))?;
    let receipt = MessageService::new(state.accounts)
        .community_command(context.actor, input)
        .await
        .map_err(|error| context.request.failure(error))?;
    Ok(Json(receipt))
}

#[utoipa::path(operation_id = "community_members", get, path = "/api/v1/communities/{conversation_id}/members",
    params(("conversation_id" = Uuid, Path), CommunityListQuery),
    responses((status = 200, body = CommunityMemberPage)))]
async fn members(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    (Path(conversation_id), SafeQuery(page)): (Path<Uuid>, SafeQuery<CommunityListQuery>),
) -> Result<Json<CommunityMemberPage>, ApiFailure> {
    let query = CommunityPageQuery {
        conversation_id,
        page,
    };
    let page = MessageService::new(state.accounts)
        .community_members(context.actor, query)
        .await
        .map_err(|error| context.request.failure(error))?;
    Ok(Json(page))
}

#[utoipa::path(operation_id = "community_requests", get, path = "/api/v1/communities/{conversation_id}/requests",
    params(("conversation_id" = Uuid, Path), CommunityListQuery),
    responses((status = 200, body = JoinRequestPage)))]
async fn requests(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    (Path(conversation_id), SafeQuery(page)): (Path<Uuid>, SafeQuery<CommunityListQuery>),
) -> Result<Json<JoinRequestPage>, ApiFailure> {
    let query = CommunityPageQuery {
        conversation_id,
        page,
    };
    let page = MessageService::new(state.accounts)
        .community_requests(context.actor, query)
        .await
        .map_err(|error| context.request.failure(error))?;
    Ok(Json(page))
}

#[utoipa::path(operation_id = "community_invitations", get, path = "/api/v1/communities/{conversation_id}/invitations",
    params(("conversation_id" = Uuid, Path), CommunityListQuery),
    responses((status = 200, body = InvitationPage)))]
async fn invitations(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    (Path(conversation_id), SafeQuery(page)): (Path<Uuid>, SafeQuery<CommunityListQuery>),
) -> Result<Json<InvitationPage>, ApiFailure> {
    let query = InvitationQuery {
        conversation_id: Some(conversation_id),
        page,
    };
    let page = MessageService::new(state.accounts)
        .community_invitations(context.actor, query)
        .await
        .map_err(|error| context.request.failure(error))?;
    Ok(Json(page))
}

#[utoipa::path(operation_id = "community_inbox", get, path = "/api/v1/community-invitations", params(CommunityListQuery),
    responses((status = 200, body = InvitationPage)))]
async fn inbox(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeQuery(page): SafeQuery<CommunityListQuery>,
) -> Result<Json<InvitationPage>, ApiFailure> {
    let query = InvitationQuery {
        conversation_id: None,
        page,
    };
    let page = MessageService::new(state.accounts)
        .community_invitations(context.actor, query)
        .await
        .map_err(|error| context.request.failure(error))?;
    Ok(Json(page))
}

#[utoipa::path(operation_id = "community_preview", post, path = "/api/v1/community-invitations/preview", request_body = InvitePreviewInput,
    responses((status = 200, body = InvitePreview)))]
async fn preview(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<InvitePreviewInput>,
) -> Result<Json<InvitePreview>, ApiFailure> {
    // Keep the bearer secret out of request URLs and ordinary access logs.
    let preview = MessageService::new(state.accounts)
        .invite_preview(context.actor, input.token)
        .await
        .map_err(|error| context.request.failure(error))?;
    Ok(Json(preview))
}

/// Attach community routes to the account-owned cookie, Origin, CSRF, and no-store boundary.
pub(crate) fn router() -> Router<AccountHttpState> {
    let routes = Router::new()
        .route("/communities", get(discover).post(create))
        .route("/communities/commands", post(command));
    let routes = routes
        .route("/communities/{conversation_id}", get(details))
        .route("/communities/{conversation_id}/members", get(members))
        .route("/communities/{conversation_id}/requests", get(requests));
    let routes = routes
        .route("/communities/{conversation_id}/invitations", get(invitations))
        .route("/community-invitations", get(inbox))
        .route("/community-invitations/preview", post(preview));
    routes.layer(DefaultBodyLimit::max(MAX_COMMUNITY_BODY_BYTES))
}
