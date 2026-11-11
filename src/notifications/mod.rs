//! Session-bound Web Push subscriptions and committed notification intents.

pub mod delivery;
pub(crate) mod http;
mod provider;

use std::collections::HashMap;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::accounts::{AccountError, AccountService, Actor, sessions::lock_actor};

use self::provider::{EndpointPolicy, valid_public_key};

const INTENT_SECONDS: i64 = 300;
const AUTH_KEY_BYTES: usize = 16;
const AUTH_KEY_LENGTH: usize = 22;
const PUBLIC_KEY_LENGTH: usize = 87;

#[derive(Default, Serialize, ToSchema)]
pub struct PushCapability {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vapid_public_key: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PushSubscriptionInput {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub expiration_time: Option<i64>,
}

#[derive(Serialize, ToSchema)]
pub struct PushSubscriptionReceipt {
    pub subscription_id: Uuid,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ToSchema)]
pub struct NotificationIdentity {
    pub deployment_id: Uuid,
    pub message_id: Uuid,
    pub subscription_id: Uuid,
}

#[derive(Clone, Serialize, ToSchema)]
pub struct PushPayload {
    pub identity: NotificationIdentity,
    pub conversation_id: Uuid,
}

#[derive(Clone)]
pub struct NotificationService {
    accounts: AccountService,
    public_key: Option<String>,
    policy: EndpointPolicy,
}

struct ValidatedSubscription {
    endpoint: url::Url,
    p256dh: Vec<u8>,
    auth: Vec<u8>,
    expires_at: Option<DateTime<Utc>>,
}

fn parse_subscription(
    input: PushSubscriptionInput,
    policy: &EndpointPolicy,
) -> Result<ValidatedSubscription, AccountError> {
    let endpoint = policy.parse(&input.endpoint)?;
    let p256dh = decode_public_key(&input.p256dh)
        .ok_or(AccountError::Validation("invalid Push public key"))?;
    if input.auth.len() != AUTH_KEY_LENGTH {
        return Err(AccountError::Validation("invalid Push authentication key"));
    }
    let auth = URL_SAFE_NO_PAD
        .decode(input.auth)
        .map_err(|_| AccountError::Validation("invalid Push authentication key"))?;
    if auth.len() != AUTH_KEY_BYTES {
        return Err(AccountError::Validation("invalid Push authentication key"));
    }
    let expires_at = match input.expiration_time {
        Some(milliseconds) => Some(
            DateTime::from_timestamp_millis(milliseconds)
                .filter(|deadline| *deadline > Utc::now())
                .ok_or(AccountError::Validation("invalid Push subscription expiry"))?,
        ),
        None => None,
    };

    Ok(ValidatedSubscription {
        endpoint,
        p256dh,
        auth,
        expires_at,
    })
}

fn decode_public_key(value: &str) -> Option<Vec<u8>> {
    if value.len() != PUBLIC_KEY_LENGTH {
        return None;
    }
    let key = URL_SAFE_NO_PAD.decode(value).ok()?;
    valid_public_key(&key).then_some(key)
}

impl NotificationService {
    /// Configure subscription admission from public API settings only.
    pub fn from_values(accounts: AccountService, values: &HashMap<String, String>) -> Self {
        let public_key = values
            .get("TG_CHAT_PUSH_VAPID_PUBLIC_KEY")
            .filter(|value| decode_public_key(value).is_some())
            .cloned();

        Self {
            accounts,
            public_key,
            policy: EndpointPolicy::from_values(values),
        }
    }

    /// Report the public key only when this deployment accepts Push subscriptions.
    pub fn capability(&self) -> PushCapability {
        PushCapability {
            available: self.public_key.is_some(),
            vapid_public_key: self.public_key.clone(),
        }
    }

    /// Store one browser subscription under its active session.
    pub async fn subscribe(
        &self,
        actor: &Actor,
        input: PushSubscriptionInput,
    ) -> Result<PushSubscriptionReceipt, AccountError> {
        if self.public_key.is_none() {
            return Err(AccountError::Unavailable);
        }
        let subscription = parse_subscription(input, &self.policy)?;
        let mut transaction = self.accounts.pool.begin().await?;
        lock_actor(&mut transaction, actor, &self.accounts.settings).await?;

        // Preserve notification identities on retries, and fence leases when credentials change.
        let replace = sqlx::query(
            "DELETE FROM push_subscriptions WHERE session_id = $1
               AND (endpoint, p256dh, auth) IS DISTINCT FROM ($2, $3, $4)",
        );
        let replace = replace.bind(actor.session_id).bind(subscription.endpoint.as_str());
        let replace = replace.bind(&subscription.p256dh).bind(&subscription.auth);
        replace.execute(&mut *transaction).await?;
        let insert = sqlx::query_scalar(
            "INSERT INTO push_subscriptions (session_id, endpoint, p256dh, auth, expires_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (session_id) DO UPDATE SET expires_at = EXCLUDED.expires_at
             RETURNING id",
        );
        let insert = insert.bind(actor.session_id).bind(subscription.endpoint.as_str());
        let insert = insert.bind(subscription.p256dh).bind(subscription.auth);
        let insert = insert.bind(subscription.expires_at);
        let subscription_id = insert.fetch_one(&mut *transaction).await.map_err(|error| {
            if error.as_database_error().is_some_and(|error| error.is_unique_violation()) {
                return AccountError::Conflict;
            }
            error.into()
        })?;
        transaction.commit().await?;

        Ok(PushSubscriptionReceipt {
            subscription_id,
        })
    }
}

impl AccountService {
    /// Remove this session's Push endpoint without changing its login state.
    pub async fn remove_push_subscription(&self, actor: &Actor) -> Result<(), AccountError> {
        let mut transaction = self.pool.begin().await?;
        lock_actor(&mut transaction, actor, &self.settings).await?;
        let delete = sqlx::query("DELETE FROM push_subscriptions WHERE session_id = $1");
        delete.bind(actor.session_id).execute(&mut *transaction).await?;
        transaction.commit().await?;

        Ok(())
    }
}

/// Record eligible new-message work as part of the acceptance transaction.
pub(crate) async fn enqueue(
    connection: &mut PgConnection,
    message_id: Uuid,
) -> Result<(), sqlx::Error> {
    let insert = sqlx::query(
        "INSERT INTO push_intents (message_id, recipient_ids, created_at, expires_at)
         SELECT message.id, recipients.ids, clock_timestamp(),
                clock_timestamp() + $2::bigint * interval '1 second'
         FROM messages message
         JOIN conversations conversation ON conversation.id = message.conversation_id
         CROSS JOIN LATERAL (
             SELECT array_agg(member.user_id ORDER BY member.user_id) AS ids
             FROM conversation_members member
             WHERE member.conversation_id = message.conversation_id AND member.directory_active
               AND NOT member.is_banned AND member.user_id <> message.author_id
               AND EXISTS (
                   SELECT 1 FROM sessions session
                   JOIN push_subscriptions subscription ON subscription.session_id = session.id
                   WHERE session.user_id = member.user_id AND session.revoked_at IS NULL
               )
         ) recipients
         WHERE message.id = $1 AND message.service_kind IS NULL AND conversation.kind <> 'saved'
           AND recipients.ids IS NOT NULL
         ON CONFLICT (message_id) DO NOTHING",
    );
    insert.bind(message_id).bind(INTENT_SECONDS).execute(connection).await?;

    Ok(())
}
