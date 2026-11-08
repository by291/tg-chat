use std::{sync::Arc, time::Duration};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use redis::aio::ConnectionManager;
use sha2::{Digest, Sha256};
use tokio::{sync::OnceCell, time::timeout};

use super::{AccountError, transport::HttpSettings};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
const WINDOW_SECONDS: u64 = 60;
const IDENTITY_LIMIT: u64 = 10;
const CLIENT_LIMIT: u64 = 20;
const MESSAGE_LIMIT: u64 = 120;
const REGISTRATION_LIMIT: u64 = 5;
const REGISTRATION_WINDOW_SECONDS: u64 = 600;
const COUNTER_SCRIPT: &str = "
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
";

#[derive(Clone)]
pub(crate) struct RateLimiter {
    client: redis::Client,
    connection: Arc<OnceCell<ConnectionManager>>,
    namespace: String,
}

impl RateLimiter {
    /// Lazily connect so a Valkey outage does not disable existing authenticated account reads.
    pub(crate) fn new(settings: &HttpSettings) -> Self {
        Self {
            client: redis::Client::open(settings.valkey_url.as_str())
                .expect("validated Valkey URL"),
            connection: Arc::new(OnceCell::new()),
            namespace: settings.rate_namespace.clone(),
        }
    }

    /// Bound both client and identity work before entering expensive credential operations.
    pub(crate) async fn admit(
        &self,
        scope: &str,
        client: &str,
        identity: &str,
    ) -> Result<(), AccountError> {
        let operation = async {
            self.count(&format!("{scope}:client:{client}"), CLIENT_LIMIT, WINDOW_SECONDS).await?;
            self.count(&format!("{scope}:identity:{identity}"), IDENTITY_LIMIT, WINDOW_SECONDS)
                .await?;
            if scope == "register" {
                self.count(
                    &format!("registration:{client}"),
                    REGISTRATION_LIMIT,
                    REGISTRATION_WINDOW_SECONDS,
                )
                .await?;
            }
            Ok(())
        };

        timeout(REQUEST_TIMEOUT, operation).await.map_err(|_| AccountError::Unavailable)?
    }

    /// Bound authenticated sends independently of the stricter credential admission limits.
    pub(crate) async fn admit_message(&self, user_id: &str) -> Result<(), AccountError> {
        let bucket = format!("message:{user_id}");
        let operation = self.count(&bucket, MESSAGE_LIMIT, WINDOW_SECONDS);

        timeout(REQUEST_TIMEOUT, operation).await.map_err(|_| AccountError::Unavailable)?
    }

    async fn count(
        &self,
        bucket: &str,
        limit: u64,
        window_seconds: u64,
    ) -> Result<(), AccountError> {
        let connection = self
            .connection
            .get_or_try_init(|| self.client.get_connection_manager())
            .await
            .map_err(|_| AccountError::Unavailable)?;
        let mut connection = connection.clone();
        // Hash buckets so usernames, email addresses, and client IPs do not become cache keys.
        let digest = Sha256::digest(bucket.as_bytes());
        let bucket_hash = URL_SAFE_NO_PAD.encode(digest);
        let key = format!("{}:rate:{bucket_hash}", self.namespace);
        let script = redis::Script::new(COUNTER_SCRIPT);
        let mut invocation = script.prepare_invoke();
        invocation.key(key).arg(window_seconds);
        let count: u64 = invocation
            .invoke_async(&mut connection)
            .await
            .map_err(|_| AccountError::Unavailable)?;
        if count > limit {
            return Err(AccountError::RateLimited);
        }

        Ok(())
    }
}
