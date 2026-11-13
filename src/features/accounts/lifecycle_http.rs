use axum::{
    Json, Router,
    extract::State,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Serialize;
use utoipa::{OpenApi, ToSchema};

use super::{
    AccountDeletionOutcome, AccountDeletionReceipt, DeleteAccount, OwnedCommunity,
    extractors::{ActorContext, ApiFailure, SafeJson},
    http::AccountHttpState,
};
use crate::http::ErrorDetails;

const OWNERSHIP_MESSAGE: &str =
    "Transfer or delete owned communities before deleting your account.";

#[derive(Serialize, ToSchema)]
struct OwnershipConflict {
    error: ErrorDetails,
    current: OwnedCommunities,
}

#[derive(Serialize, ToSchema)]
struct OwnedCommunities {
    communities: Vec<OwnedCommunity>,
}

#[derive(OpenApi)]
#[openapi(paths(delete_account))]
pub(crate) struct LifecycleDocument;

#[utoipa::path(
    post, path = "/api/v1/account/deletion", request_body = DeleteAccount,
    responses(
        (status = 200, body = AccountDeletionReceipt),
        (status = 409, body = OwnershipConflict)
    )
)]
async fn delete_account(
    State(state): State<AccountHttpState>,
    context: ActorContext,
    SafeJson(input): SafeJson<DeleteAccount>,
) -> Result<Response, ApiFailure> {
    let outcome = state
        .accounts
        .delete_account(&context.actor, input)
        .await
        .map_err(|error| context.request.failure(error))?;
    match outcome {
        AccountDeletionOutcome::Deleted(receipt) => {
            let cookie = state.settings.removal_cookie();
            let mut response = Json(receipt).into_response();
            response.headers_mut().insert(
                header::SET_COOKIE,
                HeaderValue::from_str(&cookie).expect("the configured cookie is a valid header"),
            );

            Ok(response)
        }
        AccountDeletionOutcome::OwnsCommunities(communities) => {
            let conflict = OwnershipConflict {
                error: ErrorDetails {
                    code: "account_owns_communities",
                    message: OWNERSHIP_MESSAGE.to_owned(),
                    request_id: context.request.request_id,
                },
                current: OwnedCommunities {
                    communities,
                },
            };

            Ok((StatusCode::CONFLICT, Json(conflict)).into_response())
        }
    }
}

/// Mount the authenticated account deletion operation.
pub(crate) fn router() -> Router<AccountHttpState> {
    Router::new().route("/account/deletion", post(delete_account))
}
