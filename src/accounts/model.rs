use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum AccountError {
    #[error("{0}")]
    Validation(&'static str),
    #[error("the username is unavailable")]
    UsernameUnavailable,
    #[error("the username or password is incorrect")]
    InvalidCredentials,
    #[error("a valid account session is required")]
    Unauthenticated,
    #[error("recent password authentication is required")]
    RecentAuthenticationRequired,
    #[error("the requested resource was not found")]
    NotFound,
    #[error("this action is not permitted")]
    Forbidden,
    #[error("the account changed; authenticate again before retrying")]
    Conflict,
    #[error("the account capacity has been reached")]
    QuotaExceeded,
    #[error("a required account service is temporarily unavailable")]
    Unavailable,
    #[error("registration is currently closed")]
    RegistrationClosed,
}

impl From<sqlx::Error> for AccountError {
    fn from(_: sqlx::Error) -> Self {
        // SQL diagnostics can contain private field values and must not reach the HTTP boundary.
        Self::Unavailable
    }
}

#[derive(Clone, Debug, FromRow)]
pub struct Actor {
    pub user_id: Uuid,
    pub session_id: Uuid,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct Registration {
    pub username: String,
    pub password: String,
    pub display_name: String,
    pub device_name: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct Login {
    pub username: String,
    pub password: String,
    pub device_name: String,
}

pub struct PasswordChange {
    pub actor: Actor,
    pub current_password: String,
    pub new_password: String,
}

pub struct RevokeSession {
    pub actor: Actor,
    pub session_id: Uuid,
}

#[derive(Clone, Serialize, ToSchema)]
pub struct PrivateProfile {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub biography: String,
    pub phone: Option<String>,
    pub is_operator: bool,
    pub version: String,
}

#[derive(Clone, Serialize, ToSchema)]
pub struct SessionView {
    pub id: Uuid,
    pub device_name: String,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub is_current: bool,
}

// This type deliberately has neither Debug nor Serialize: the cookie token stays server-side.
pub struct SessionGrant {
    pub user: PrivateProfile,
    pub session: SessionView,
    pub token: String,
    pub csrf_token: String,
}

#[derive(FromRow)]
pub(crate) struct UserRecord {
    pub id: Uuid,
    pub username: String,
    pub password_hash: String,
    pub credential_version: i64,
    pub display_name: String,
    pub biography: String,
    pub phone: Option<String>,
    pub is_operator: bool,
    pub is_suspended: bool,
    pub profile_version: i64,
}

impl UserRecord {
    /// Project account-owned fields without exposing credentials or suspension internals.
    pub(crate) fn private_profile(&self) -> PrivateProfile {
        PrivateProfile {
            id: self.id,
            username: self.username.clone(),
            display_name: self.display_name.clone(),
            biography: self.biography.clone(),
            phone: self.phone.clone(),
            is_operator: self.is_operator,
            version: self.profile_version.to_string(),
        }
    }
}
