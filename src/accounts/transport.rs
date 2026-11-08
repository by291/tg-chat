use std::collections::HashMap;

use cookie::{Cookie, SameSite, time::Duration};
use url::Url;

use super::AccountError;

const DEFAULT_ORIGIN: &str = "http://localhost:8080";
const DEFAULT_VALKEY_URL: &str = "redis://127.0.0.1:6379";
const COOKIE_DAYS: i64 = 30;

#[derive(Clone)]
pub struct HttpSettings {
    pub(crate) origin: String,
    pub(crate) valkey_url: String,
    pub(crate) rate_namespace: String,
    pub(crate) should_trust_gateway: bool,
    is_secure: bool,
}

impl HttpSettings {
    /// Validate the public browser origin without allowing insecure nonlocal deployments.
    pub fn from_values(values: &HashMap<String, String>) -> Result<Self, AccountError> {
        let origin =
            values.get("TG_CHAT_PUBLIC_ORIGIN").map(String::as_str).unwrap_or(DEFAULT_ORIGIN);
        let parsed =
            Url::parse(origin).map_err(|_| AccountError::Validation("invalid public origin"))?;
        let is_loopback = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        let is_secure = parsed.scheme() == "https";
        let is_supported_scheme = is_secure || (parsed.scheme() == "http" && is_loopback);
        let has_extra_components = parsed.path() != "/"
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || !parsed.username().is_empty()
            || parsed.password().is_some();
        if !is_supported_scheme || has_extra_components || parsed.host_str().is_none() {
            return Err(AccountError::Validation("public origin must be HTTPS or loopback HTTP"));
        }

        let valkey_url = values
            .get("TG_CHAT_VALKEY_URL")
            .cloned()
            .unwrap_or_else(|| DEFAULT_VALKEY_URL.to_owned());
        redis::Client::open(valkey_url.as_str())
            .map_err(|_| AccountError::Validation("invalid Valkey connection configuration"))?;
        let should_trust_gateway = match values.get("TG_CHAT_TRUST_GATEWAY").map(String::as_str) {
            None | Some("false") => false,
            Some("true") => true,
            Some(_) => {
                return Err(AccountError::Validation("TG_CHAT_TRUST_GATEWAY must be boolean"));
            }
        };
        let rate_namespace =
            values.get("TG_CHAT_RATE_NAMESPACE").cloned().unwrap_or_else(|| "tg-chat".to_owned());

        Ok(Self {
            origin: parsed.origin().ascii_serialization(),
            valkey_url,
            rate_namespace,
            should_trust_gateway,
            is_secure,
        })
    }

    /// Select a host-bound cookie name on HTTPS deployments.
    pub fn cookie_name(&self) -> &'static str {
        if self.is_secure {
            return "__Host-tg_chat_session";
        }

        "tg_chat_session"
    }

    /// Issue the opaque session as an HttpOnly cookie, keeping secrets out of response JSON.
    pub fn session_cookie(&self, token: &str) -> String {
        let cookie = Cookie::build((self.cookie_name(), token)).path("/").http_only(true);
        let cookie = cookie.same_site(SameSite::Lax).secure(self.is_secure);

        cookie.max_age(Duration::days(COOKIE_DAYS)).build().to_string()
    }

    /// Expire precisely the same cookie scope used for session admission.
    pub fn removal_cookie(&self) -> String {
        let mut cookie = Cookie::parse(self.session_cookie("")).expect("server cookie is valid");
        cookie.make_removal();

        cookie.to_string()
    }
}
