//! LiveKit room operations and provider credentials for designated call participants.

use std::{collections::HashMap, sync::Arc, time::Duration};

use chrono::{DateTime, TimeDelta, Utc};
use livekit_api::{
    access_token::{AccessToken, TokenVerifier, VideoGrants},
    services::{
        ServerError, ServerErrorCode, ServiceError,
        room::{CreateRoomOptions, RoomClient},
    },
    webhooks::WebhookReceiver,
};
use serde::Serialize;
use url::{Host, Url};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::accounts::AccountError;

const ROOM_CAPACITY: u32 = 2;
const EMPTY_TIMEOUT_SECONDS: u32 = 60;
const DEPARTURE_TIMEOUT_SECONDS: u32 = 45;
const TOKEN_SECONDS: u64 = 60;
const PROVIDER_REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
const MIN_SECRET_LENGTH: usize = 32;
const MAX_WEBHOOK_EVENT_ID_LENGTH: usize = 128;
const DEFAULT_ORIGIN: &str = "http://localhost:8080";
const INVALID_CONFIGURATION: AccountError = AccountError::Validation("invalid call configuration");

#[derive(Clone)]
pub(crate) struct LiveKit {
    client: Arc<RoomClient>,
    verifier: TokenVerifier,
    settings: Arc<ProviderSettings>,
}

struct ProviderSettings {
    public_url: Url,
    api_key: String,
    api_secret: String,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct RoomCredentials {
    url: String,
    token: String,
    expires_at: DateTime<Utc>,
}

#[cfg(test)]
impl RoomCredentials {
    /// Read the in-memory credential for application admission tests.
    pub(super) fn token(&self) -> &str {
        &self.token
    }
}

pub(crate) struct RoomSnapshot {
    pub sid: String,
    pub connected_participants: Vec<Uuid>,
}

pub(crate) struct ProviderIdentity {
    pub room: String,
    pub participant: Uuid,
}

pub(crate) struct VerifiedRoomEvent {
    pub id: String,
    pub room: String,
    pub sid: String,
}

fn required<'a>(values: &'a HashMap<String, String>, key: &str) -> Result<&'a str, AccountError> {
    values
        .get(key)
        .filter(|value| !value.is_empty())
        .map(String::as_str)
        .ok_or(INVALID_CONFIGURATION)
}

fn has_plain_origin(url: &Url) -> bool {
    url.host().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none()
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(host)) => host == "localhost",
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

fn signaling_url(values: &HashMap<String, String>) -> Result<Url, AccountError> {
    let origin = values.get("TG_CHAT_PUBLIC_ORIGIN").map_or(DEFAULT_ORIGIN, String::as_str);
    let mut gateway = Url::parse(origin).map_err(|_| INVALID_CONFIGURATION)?;
    let scheme = match gateway.scheme() {
        "https" => "wss",
        "http" if is_loopback(&gateway) => "ws",
        _ => return Err(INVALID_CONFIGURATION),
    };
    gateway.set_scheme(scheme).map_err(|_| INVALID_CONFIGURATION)?;
    if !has_plain_origin(&gateway) {
        return Err(INVALID_CONFIGURATION);
    }

    if let Some(configured) =
        values.get("TG_CHAT_LIVEKIT_PUBLIC_URL").filter(|value| !value.is_empty())
    {
        // The same-origin gateway checks application call state before forwarding a join.
        let public = Url::parse(configured).map_err(|_| INVALID_CONFIGURATION)?;
        if public != gateway {
            return Err(INVALID_CONFIGURATION);
        }
    }

    Ok(gateway)
}

impl LiveKit {
    /// Configure the optional provider without making any network calls.
    pub(crate) fn from_values(
        values: &HashMap<String, String>,
    ) -> Result<Option<Self>, AccountError> {
        if values.get("TG_CHAT_CALLS_ENABLED").is_none_or(|value| value == "false") {
            return Ok(None);
        }
        if !values.get("TG_CHAT_CALLS_ENABLED").is_some_and(|value| value == "true") {
            return Err(INVALID_CONFIGURATION);
        }

        let internal_url = required(values, "TG_CHAT_LIVEKIT_INTERNAL_URL")?;
        let internal_url = Url::parse(internal_url).map_err(|_| INVALID_CONFIGURATION)?;
        if !has_plain_origin(&internal_url) || !matches!(internal_url.scheme(), "http" | "https") {
            return Err(INVALID_CONFIGURATION);
        }
        let settings = ProviderSettings {
            public_url: signaling_url(values)?,
            api_key: required(values, "TG_CHAT_LIVEKIT_API_KEY")?.to_owned(),
            api_secret: required(values, "TG_CHAT_LIVEKIT_API_SECRET")?.to_owned(),
        };
        if settings.api_secret.len() < MIN_SECRET_LENGTH {
            return Err(INVALID_CONFIGURATION);
        }
        let client = RoomClient::with_api_key(
            internal_url.as_str(),
            &settings.api_key,
            &settings.api_secret,
        );
        let client = client.with_failover(false).with_request_timeout(PROVIDER_REQUEST_TIMEOUT);
        let verifier = TokenVerifier::with_api_key(&settings.api_key, &settings.api_secret);

        Ok(Some(Self {
            client: Arc::new(client),
            verifier,
            settings: Arc::new(settings),
        }))
    }

    /// Create the bounded room assigned to an accepted call.
    pub(crate) async fn create(&self, name: &str) -> Result<String, AccountError> {
        let options = CreateRoomOptions {
            empty_timeout: EMPTY_TIMEOUT_SECONDS,
            departure_timeout: DEPARTURE_TIMEOUT_SECONDS,
            max_participants: ROOM_CAPACITY,
            ..Default::default()
        };
        let room = self.client.create_room(name, options).await;
        let room = room.map_err(|_| AccountError::Unavailable)?;
        if room.name != name || room.sid.is_empty() {
            return Err(AccountError::Unavailable);
        }

        Ok(room.sid)
    }

    /// Read the room's current media-active participant identities.
    pub(crate) async fn inspect(&self, name: &str) -> Result<Option<RoomSnapshot>, AccountError> {
        let rooms = self.client.list_rooms(vec![name.to_owned()]).await;
        let rooms = rooms.map_err(|_| AccountError::Unavailable)?;
        let Some(room) = rooms.into_iter().find(|room| room.name == name) else {
            return Ok(None);
        };

        let participants = self.client.list_participants(name).await;
        let participants = participants.map_err(|_| AccountError::Unavailable)?;
        let connected_participants = participants
            .into_iter()
            .filter(|participant| participant.state().as_str_name() == "ACTIVE")
            .filter_map(|participant| participant.identity.parse().ok());
        let connected_participants = connected_participants.collect();

        Ok(Some(RoomSnapshot {
            sid: room.sid,
            connected_participants,
        }))
    }

    /// Delete the call room, treating an already absent room as clean.
    pub(crate) async fn delete(&self, name: &str) -> Result<(), AccountError> {
        match self.client.delete_room(name).await {
            Ok(()) => Ok(()),
            Err(ServiceError::Twirp(ServerError::Twirp(error)))
                if error.code == ServerErrorCode::NOT_FOUND =>
            {
                Ok(())
            }
            Err(_) => Err(AccountError::Unavailable),
        }
    }

    /// Sign a short-lived media-only token for one room and its opaque participant identity.
    pub(crate) fn issue(
        &self,
        room: &str,
        participant: Uuid,
    ) -> Result<RoomCredentials, AccountError> {
        let grants = VideoGrants {
            room_join: true,
            room: room.to_owned(),
            can_publish: Some(true),
            can_subscribe: Some(true),
            can_publish_data: Some(false),
            can_update_own_metadata: Some(false),
            can_publish_sources: vec!["microphone".to_owned(), "camera".to_owned()],
            ..Default::default()
        };
        let expires_at = Utc::now() + TimeDelta::seconds(TOKEN_SECONDS as i64);
        let token = AccessToken::with_api_key(&self.settings.api_key, &self.settings.api_secret);
        let token = token.with_identity(&participant.to_string());
        let token = token.with_grants(grants).with_ttl(Duration::from_secs(TOKEN_SECONDS));
        let token = token.to_jwt().map_err(|_| AccountError::Unavailable)?;

        Ok(RoomCredentials {
            url: self.settings.public_url.to_string(),
            token,
            expires_at,
        })
    }

    /// Validate a provider credential before resolving its participant to a current call.
    pub(crate) fn verify_identity(&self, token: &str) -> Result<ProviderIdentity, AccountError> {
        let claims = self.verifier.verify(token).map_err(|_| AccountError::Forbidden)?;
        if !claims.video.room_join || claims.video.room.is_empty() || claims.video.room_create {
            return Err(AccountError::Forbidden);
        }
        let participant = claims.sub.parse().map_err(|_| AccountError::Forbidden)?;

        Ok(ProviderIdentity {
            room: claims.video.room,
            participant,
        })
    }

    /// Verify a provider webhook before returning its bounded room observation hint.
    pub(crate) fn verify_webhook(
        &self,
        body: &str,
        token: &str,
    ) -> Result<Option<VerifiedRoomEvent>, AccountError> {
        let receiver = WebhookReceiver::new(self.verifier.clone());
        let event = receiver.receive(body, token).map_err(|_| AccountError::Forbidden)?;
        if !matches!(
            event.event.as_str(),
            "participant_joined"
                | "participant_left"
                | "participant_connection_aborted"
                | "room_finished"
        ) {
            return Ok(None);
        }
        let Some(room) = event.room else {
            return Ok(None);
        };
        if event.id.is_empty() || event.id.len() > MAX_WEBHOOK_EVENT_ID_LENGTH {
            return Err(AccountError::Validation("invalid room event"));
        }

        Ok(Some(VerifiedRoomEvent {
            id: event.id,
            room: room.name,
            sid: room.sid,
        }))
    }
}

#[cfg(test)]
mod tests;
