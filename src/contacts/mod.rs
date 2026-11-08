//! Directional relationships and account-owned visibility preferences.

mod directory;
pub(crate) mod http;
mod relationships;

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::accounts::{AccountError, AccountService, Actor, sessions::lock_actor};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize, ToSchema, sqlx::Type)]
#[sqlx(type_name = "privacy_audience", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum Audience {
    Everyone,
    Contacts,
    Nobody,
}

#[derive(Deserialize, FromRow, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PrivacySettings {
    #[sqlx(rename = "direct_message_audience")]
    pub direct_messages: Audience,
    #[sqlx(rename = "call_audience")]
    pub calls: Audience,
    #[sqlx(rename = "presence_audience")]
    pub presence: Audience,
}

#[derive(FromRow, Serialize, ToSchema)]
pub struct PublicProfile {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub biography: String,
}

#[derive(Default, Deserialize, IntoParams)]
#[serde(deny_unknown_fields)]
pub struct DirectoryQuery {
    pub search: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<u16>,
}

#[derive(Serialize, ToSchema)]
pub struct DirectoryPage {
    pub users: Vec<PublicProfile>,
    pub next_cursor: Option<String>,
}

pub struct RelationshipChange {
    pub actor: Actor,
    pub target_id: Uuid,
}

impl AccountService {
    /// Return only the caller's direct-message, call, and presence preferences.
    pub async fn privacy(&self, actor: &Actor) -> Result<PrivacySettings, AccountError> {
        let mut transaction = self.pool.begin().await?;
        lock_actor(&mut transaction, actor, &self.settings).await?;
        let privacy = sqlx::query_as::<_, PrivacySettings>("SELECT * FROM users WHERE id = $1")
            .bind(actor.user_id)
            .fetch_one(&mut *transaction)
            .await?;
        transaction.commit().await?;

        Ok(privacy)
    }

    /// Replace visibility preferences under the same authorization lock as session revocation.
    pub async fn update_privacy(
        &self,
        actor: &Actor,
        input: PrivacySettings,
    ) -> Result<PrivacySettings, AccountError> {
        let mut transaction = self.pool.begin().await?;
        lock_actor(&mut transaction, actor, &self.settings).await?;
        let update = sqlx::query_as::<_, PrivacySettings>(
            "UPDATE users SET direct_message_audience = $1, call_audience = $2,
             presence_audience = $3 WHERE id = $4 RETURNING *",
        )
        .bind(input.direct_messages)
        .bind(input.calls);
        let update = update.bind(input.presence).bind(actor.user_id);
        let privacy = update.fetch_one(&mut *transaction).await?;
        transaction.commit().await?;

        Ok(privacy)
    }
}
