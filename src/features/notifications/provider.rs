use std::{collections::HashMap, net::SocketAddr, time::Duration};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use tokio::{
    net::lookup_host,
    time::{Instant, timeout},
};
use url::{Host, Url};
use web_push_native::{
    Auth, WebPushBuilder,
    jwt_simple::algorithms::ES256KeyPair,
    p256::{PublicKey, elliptic_curve::sec1::ToEncodedPoint},
};

use crate::{
    features::accounts::AccountError,
    network::public_address::{is_public_host, is_public_ip},
};

use super::{
    AUTH_KEY_BYTES,
    delivery::{PushAttempt, PushOutcome, PushTransport},
};

const ENDPOINT_LENGTH: usize = 2048;
const PUBLIC_KEY_BYTES: usize = 65;
const PRIVATE_KEY_BYTES: usize = 32;
const DNS_TIMEOUT: Duration = Duration::from_secs(3);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(7);
const PROVIDER_ADDRESS_LIMIT: usize = 16;
const DEFAULT_PROVIDERS: &[(&str, &str)] = &[
    ("fcm.googleapis.com", "/fcm/send/"),
    ("updates.push.services.mozilla.com", "/wpush/"),
    ("web.push.apple.com", "/"),
];

#[derive(Clone)]
pub(super) struct EndpointPolicy {
    configured_hosts: Option<Vec<String>>,
}

pub(super) struct ProviderTransport {
    policy: EndpointPolicy,
    key_pair: ES256KeyPair,
    subject: String,
}

pub(super) fn valid_public_key(bytes: &[u8]) -> bool {
    bytes.len() == PUBLIC_KEY_BYTES && PublicKey::from_sec1_bytes(bytes).is_ok()
}

fn invalid_endpoint() -> AccountError {
    AccountError::Validation("unsupported Push endpoint")
}

impl EndpointPolicy {
    pub(super) fn from_values(values: &HashMap<String, String>) -> Self {
        let configured =
            values.get("TG_CHAT_PUSH_PROVIDER_HOSTS").filter(|value| !value.trim().is_empty());
        let configured_hosts = configured.map(|value| {
            value
                .split(',')
                .map(str::trim)
                .map(str::to_ascii_lowercase)
                .filter(|domain| is_public_host(&Host::Domain(domain.as_str())))
                .collect()
        });

        Self {
            configured_hosts,
        }
    }

    pub(super) fn parse(&self, endpoint: &str) -> Result<Url, AccountError> {
        if endpoint.len() > ENDPOINT_LENGTH {
            return Err(invalid_endpoint());
        }
        let url = Url::parse(endpoint).map_err(|_| invalid_endpoint())?;
        if url.as_str().len() > ENDPOINT_LENGTH {
            return Err(invalid_endpoint());
        }
        let has_https_origin = url.scheme() == "https"
            && url.port().is_none()
            && url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none();
        let Some(Host::Domain(host)) = url.host() else {
            return Err(invalid_endpoint());
        };
        if !has_https_origin || !is_public_host(&Host::Domain(host)) {
            return Err(invalid_endpoint());
        }
        let is_allowed = match &self.configured_hosts {
            Some(hosts) => hosts.iter().any(|provider| provider == host) && url.path() != "/",
            None => DEFAULT_PROVIDERS.iter().any(|(provider, prefix)| {
                host == *provider
                    && url.path().len() > prefix.len()
                    && url.path().starts_with(prefix)
            }),
        };
        if !is_allowed {
            return Err(invalid_endpoint());
        }

        Ok(url)
    }
}

fn valid_subject(subject: &str) -> bool {
    if let Some(email) = subject.strip_prefix("mailto:") {
        return email_address::EmailAddress::is_valid(email);
    }
    let Ok(url) = Url::parse(subject) else {
        return false;
    };

    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.host().is_some_and(|host| is_public_host(&host))
}

async fn public_destinations(host: &str) -> Result<Vec<SocketAddr>, PushOutcome> {
    let addresses = timeout(DNS_TIMEOUT, lookup_host((host, 443))).await;
    let addresses = addresses.map_err(|_| PushOutcome::Retry)?;
    let addresses = addresses.map_err(|_| PushOutcome::Retry)?;
    let addresses: Vec<SocketAddr> = addresses.take(PROVIDER_ADDRESS_LIMIT + 1).collect();
    if addresses.is_empty() {
        return Err(PushOutcome::Retry);
    }
    if addresses.len() > PROVIDER_ADDRESS_LIMIT
        || addresses.iter().any(|address| !is_public_ip(address.ip()))
    {
        return Err(PushOutcome::Rejected);
    }

    Ok(addresses)
}

fn provider_outcome(status: reqwest::StatusCode) -> PushOutcome {
    if status.is_success() {
        return PushOutcome::Sent;
    }
    match status {
        reqwest::StatusCode::NOT_FOUND | reqwest::StatusCode::GONE => PushOutcome::EndpointGone,
        reqwest::StatusCode::REQUEST_TIMEOUT | reqwest::StatusCode::TOO_MANY_REQUESTS => {
            PushOutcome::Retry
        }
        _ if status.is_server_error() => PushOutcome::Retry,
        _ => PushOutcome::Rejected,
    }
}

impl ProviderTransport {
    pub(super) fn from_values(values: &HashMap<String, String>) -> Option<Self> {
        let public_key = values.get("TG_CHAT_PUSH_VAPID_PUBLIC_KEY")?;
        let private_key = values.get("TG_CHAT_PUSH_VAPID_PRIVATE_KEY")?;
        let subject = values.get("TG_CHAT_PUSH_VAPID_SUBJECT")?;
        let private_key = URL_SAFE_NO_PAD.decode(private_key).ok()?;
        // Compose passes empty values for disabled Push, and the signer expects a fixed size.
        let private_key: [u8; PRIVATE_KEY_BYTES] = private_key.try_into().ok()?;
        let key_pair = ES256KeyPair::from_bytes(&private_key).ok()?;
        let derived_public = key_pair.public_key().to_bytes();
        let derived_public = PublicKey::from_sec1_bytes(&derived_public).ok()?;
        let derived_public = derived_public.to_encoded_point(false);
        if URL_SAFE_NO_PAD.encode(derived_public.as_bytes()) != *public_key
            || !valid_subject(subject)
        {
            return None;
        }

        Some(Self {
            policy: EndpointPolicy::from_values(values),
            key_pair,
            subject: subject.clone(),
        })
    }

    async fn send_request(&self, attempt: PushAttempt<'_>) -> Result<PushOutcome, PushOutcome> {
        let started = Instant::now();
        let endpoint = self.policy.parse(attempt.endpoint).map_err(|_| PushOutcome::Rejected)?;
        let host = endpoint.host_str().ok_or(PushOutcome::Rejected)?;
        let addresses = public_destinations(host).await?;
        let key = PublicKey::from_sec1_bytes(attempt.p256dh).map_err(|_| PushOutcome::Rejected)?;
        let auth: [u8; AUTH_KEY_BYTES] =
            attempt.auth.try_into().map_err(|_| PushOutcome::Rejected)?;
        let auth = Auth::from(auth);
        let uri = endpoint.as_str().parse().map_err(|_| PushOutcome::Rejected)?;
        let body = serde_json::to_vec(attempt.payload).map_err(|_| PushOutcome::Rejected)?;
        let remaining = attempt.ttl.saturating_sub(started.elapsed());
        if remaining.as_secs() == 0 {
            return Ok(PushOutcome::Expired);
        }
        let push = WebPushBuilder::new(uri, key, auth);
        let push = push.with_valid_duration(remaining);
        let push = push.with_vapid(&self.key_pair, &self.subject);
        let request = push.build(body).map_err(|_| PushOutcome::Rejected)?;
        let (headers, body) = request.into_parts();

        // Keep the validated address set for this TLS request and prevent proxy or redirect hops.
        let client = reqwest::Client::builder().resolve_to_addrs(host, &addresses);
        let client = client.no_proxy().redirect(reqwest::redirect::Policy::none());
        let client = client.timeout(REQUEST_TIMEOUT).build().map_err(|_| PushOutcome::Retry)?;
        let request = client.post(endpoint).headers(headers.headers).body(body);
        let response = request.send().await.map_err(|_| PushOutcome::Retry)?;

        Ok(provider_outcome(response.status()))
    }
}

impl PushTransport for ProviderTransport {
    fn send<'a>(
        &'a self,
        attempt: PushAttempt<'a>,
    ) -> std::pin::Pin<Box<dyn Future<Output = PushOutcome> + Send + 'a>> {
        Box::pin(async move { self.send_request(attempt).await.unwrap_or_else(|outcome| outcome) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_push_accepts_empty_compose_settings() {
        let values = HashMap::from([
            ("TG_CHAT_PUSH_VAPID_PUBLIC_KEY".to_owned(), String::new()),
            ("TG_CHAT_PUSH_VAPID_PRIVATE_KEY".to_owned(), String::new()),
            ("TG_CHAT_PUSH_VAPID_SUBJECT".to_owned(), String::new()),
        ]);

        assert!(ProviderTransport::from_values(&values).is_none());
    }
}
