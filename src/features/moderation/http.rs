use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use utoipa::{IntoParams, OpenApi, ToSchema};
use uuid::Uuid;

use super::{
    OperatorCommand,
    jobs::{self, OperatorJob, OperatorJobKind},
    quarantine::{self, OperatorCommunity},
    quotas::{self, StorageUsage},
};
use crate::features::accounts::{
    AccountSettings,
    extractors::{ActorContext, ApiFailure, SafeJson, SafeQuery},
    http::AccountHttpState,
    operator::authorize_operator,
};

const DIRECTORY_LIMIT: i64 = 50;

#[derive(FromRow, Serialize, ToSchema)]
struct OperatorAccount {
    id: Uuid,
    username: String,
    display_name: String,
    is_suspended: bool,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
struct DirectoryQuery {
    search: Option<String>,
    after: Option<Uuid>,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
struct JobsQuery {
    kind: OperatorJobKind,
}

#[derive(OpenApi)]
#[openapi(paths(
    operator_command,
    operator_accounts,
    operator_communities,
    operator_jobs,
    storage
))]
pub(crate) struct ModerationDocument;

async fn read_scope<'a>(
    pool: &'a PgPool,
    settings: &AccountSettings,
    context: &ActorContext,
) -> Result<Transaction<'a, Postgres>, ApiFailure> {
    let mut transaction =
        pool.begin().await.map_err(|error| context.request.failure(error.into()))?;
    authorize_operator(&mut transaction, &context.actor, settings)
        .await
        .map_err(|error| context.request.failure(error))?;

    Ok(transaction)
}

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

#[utoipa::path(
    get, path = "/api/v1/operator/accounts", params(DirectoryQuery),
    responses((status = 200, body = Vec<OperatorAccount>))
)]
async fn operator_accounts(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeQuery(query): SafeQuery<DirectoryQuery>,
) -> Result<Json<Vec<OperatorAccount>>, ApiFailure> {
    let mut transaction =
        read_scope(&state.accounts.pool, &state.accounts.settings, &context).await?;
    let search = query.search.unwrap_or_default();
    if search.len() > 200 {
        return Err(context.request.failure(crate::features::accounts::AccountError::Validation(
            "account search is too long",
        )));
    }
    let select = sqlx::query_as(
        "SELECT id, username, display_name, is_suspended FROM users WHERE username <> ''
         AND ($1::uuid IS NULL OR id > $1)
         AND (strpos(lower(username), lower($2)) > 0 OR strpos(lower(display_name), lower($2)) > 0)
         ORDER BY id LIMIT $3",
    );
    let select = select.bind(query.after).bind(search).bind(DIRECTORY_LIMIT);
    let accounts = select
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| context.request.failure(error.into()))?;
    transaction.commit().await.map_err(|error| context.request.failure(error.into()))?;

    Ok(Json(accounts))
}

#[utoipa::path(
    get, path = "/api/v1/operator/communities", params(DirectoryQuery),
    responses((status = 200, body = Vec<OperatorCommunity>))
)]
async fn operator_communities(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeQuery(query): SafeQuery<DirectoryQuery>,
) -> Result<Json<Vec<OperatorCommunity>>, ApiFailure> {
    let mut transaction =
        read_scope(&state.accounts.pool, &state.accounts.settings, &context).await?;
    let search = query.search.as_deref().unwrap_or_default();
    let communities = quarantine::communities(&mut transaction, search, query.after)
        .await
        .map_err(|error| context.request.failure(error))?;
    transaction.commit().await.map_err(|error| context.request.failure(error.into()))?;

    Ok(Json(communities))
}

#[utoipa::path(
    get, path = "/api/v1/operator/jobs", params(JobsQuery),
    responses((status = 200, body = Vec<OperatorJob>))
)]
async fn operator_jobs(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeQuery(query): SafeQuery<JobsQuery>,
) -> Result<Json<Vec<OperatorJob>>, ApiFailure> {
    let mut transaction =
        read_scope(&state.accounts.pool, &state.accounts.settings, &context).await?;
    let jobs = jobs::list(&mut transaction, query.kind)
        .await
        .map_err(|error| context.request.failure(error))?;
    transaction.commit().await.map_err(|error| context.request.failure(error.into()))?;

    Ok(Json(jobs))
}

#[utoipa::path(
    get, path = "/api/v1/operator/storage/{user_id}", params(("user_id" = Uuid, Path)),
    responses((status = 200, body = StorageUsage))
)]
async fn storage(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    Path(user_id): Path<Uuid>,
) -> Result<Json<StorageUsage>, ApiFailure> {
    let mut transaction =
        read_scope(&state.accounts.pool, &state.accounts.settings, &context).await?;
    let usage = quotas::usage(&mut transaction, user_id)
        .await
        .map_err(|error| context.request.failure(error))?;
    transaction.commit().await.map_err(|error| context.request.failure(error.into()))?;

    Ok(Json(usage))
}

/// Build the authenticated operator console routes inside the existing browser boundary.
pub(crate) fn router() -> Router<AccountHttpState> {
    let routes = Router::new()
        .route("/operator/commands", post(operator_command))
        .route("/operator/accounts", get(operator_accounts))
        .route("/operator/communities", get(operator_communities));
    routes
        .route("/operator/jobs", get(operator_jobs))
        .route("/operator/storage/{user_id}", get(storage))
}
