use std::time::Duration;

use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::RealtimeSettings;
use crate::{accounts::AccountError, jobs::wakeups::WakeupClaim, sync::cursor::CursorScope};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(1);

#[derive(Clone)]
pub struct RealtimeClient {
    client: reqwest::Client,
    settings: RealtimeSettings,
}

impl RealtimeClient {
    /// Create a bounded HTTP pool for Centrifugo's authenticated server API.
    pub fn new(settings: RealtimeSettings) -> Result<Self, AccountError> {
        let builder =
            reqwest::Client::builder().timeout(REQUEST_TIMEOUT).connect_timeout(CONNECT_TIMEOUT);
        let client = builder
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| AccountError::Unavailable)?;

        Ok(Self {
            client,
            settings,
        })
    }

    async fn invoke(&self, method: &str, payload: Value) -> Result<(), AccountError> {
        let endpoint = self
            .settings
            .endpoint
            .join(&format!("api/{method}"))
            .map_err(|_| AccountError::Unavailable)?;
        let request =
            self.client.post(endpoint).header("X-API-Key", &self.settings.api_key).json(&payload);
        let response = request.send().await.map_err(|_| AccountError::Unavailable)?;
        if !response.status().is_success() {
            return Err(AccountError::Unavailable);
        }
        let response: Value = response.json().await.map_err(|_| AccountError::Unavailable)?;
        if response.get("error").is_some() || response.get("result").is_none() {
            return Err(AccountError::Unavailable);
        }

        Ok(())
    }

    /// Publish a cursor-only hint without private content, safe to duplicate or reorder.
    pub async fn publish(&self, pool: &PgPool, claim: &WakeupClaim) -> Result<(), AccountError> {
        let mut connection = pool.acquire().await?;
        let scope = CursorScope::read(&mut connection, claim.user_id).await?;
        drop(connection);
        self.invoke(
            "publish",
            json!({
                "channel": format!("personal:{}", claim.user_id),
                "data": {"schema_version": 1, "cursor": scope.encode(claim.position)}
            }),
        )
        .await
    }

    /// Wake an authorized peer to refetch activity without disclosing identities or lease state.
    pub(super) async fn publish_activity_hint(&self, peer_id: Uuid) -> Result<(), AccountError> {
        self.invoke(
            "publish",
            json!({
                "channel": format!("personal:{peer_id}"),
                "data": {"schema_version": 1, "kind": "activity"}
            }),
        )
        .await
    }

    /// Disconnect a single registered client after its application session is revoked or expired.
    pub async fn disconnect(&self, user_id: Uuid, client_id: Uuid) -> Result<(), AccountError> {
        self.invoke(
            "disconnect",
            json!({
                "user": user_id,
                "client": client_id,
                "disconnect": {"code": 4501, "reason": "session expired"}
            }),
        )
        .await
    }
}
