use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use uuid::Uuid;

use crate::features::accounts::AccountError;

const MAX_CURSOR_BYTES: usize = 512;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    deployment_id: Uuid,
    user_id: Uuid,
    position: String,
}

pub(crate) struct CursorScope {
    pub deployment_id: Uuid,
    pub user_id: Uuid,
    pub position: i64,
    pub retained_floor: i64,
}

impl CursorScope {
    /// Load cursor boundaries from the same snapshot as the entities being returned.
    pub async fn read(connection: &mut PgConnection, user_id: Uuid) -> Result<Self, AccountError> {
        let (deployment_id, position, retained_floor) = sqlx::query_as(
            "SELECT deployment.id, head.position, head.retained_floor
             FROM deployment_identity deployment CROSS JOIN sync_heads head WHERE head.user_id = $1",
        )
        .bind(user_id).fetch_one(connection).await?;

        Ok(Self {
            deployment_id,
            user_id,
            position,
            retained_floor,
        })
    }

    /// Bind an opaque decimal counter to both the account and deployment.
    pub fn encode(&self, position: i64) -> String {
        let cursor = Cursor {
            deployment_id: self.deployment_id,
            user_id: self.user_id,
            position: position.to_string(),
        };
        let serialized = serde_json::to_vec(&cursor).expect("cursor fields are serializable");

        URL_SAFE_NO_PAD.encode(serialized)
    }

    /// Reject foreign, pruned, malformed, and future positions before selecting any changes.
    pub fn decode(&self, encoded: &str) -> Result<i64, AccountError> {
        if encoded.len() > MAX_CURSOR_BYTES {
            return Err(AccountError::SyncResetRequired);
        }
        let decoded =
            URL_SAFE_NO_PAD.decode(encoded).map_err(|_| AccountError::SyncResetRequired)?;
        let cursor: Cursor =
            serde_json::from_slice(&decoded).map_err(|_| AccountError::SyncResetRequired)?;
        let position =
            cursor.position.parse::<i64>().map_err(|_| AccountError::SyncResetRequired)?;
        let is_valid = cursor.deployment_id == self.deployment_id
            && cursor.user_id == self.user_id
            && position >= self.retained_floor
            && position <= self.position;
        if !is_valid {
            return Err(AccountError::SyncResetRequired);
        }

        Ok(position)
    }
}
