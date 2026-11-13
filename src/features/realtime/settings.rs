use std::collections::HashMap;

use crate::features::accounts::{AccountError, transport::HttpSettings};

const MIN_SECRET_BYTES: usize = 32;
const DEFAULT_ENDPOINT: &str = "http://127.0.0.1:8000";

#[derive(Clone)]
pub struct RealtimeSettings {
    pub(crate) endpoint: url::Url,
    pub(crate) api_key: String,
    pub(crate) proxy_key: String,
    pub(crate) transport: HttpSettings,
}

impl RealtimeSettings {
    /// Validate optional realtime credentials without exposing them through diagnostic output.
    pub fn from_values(values: &HashMap<String, String>) -> Result<Option<Self>, AccountError> {
        let proxy_key =
            values.get("TG_CHAT_CENTRIFUGO_PROXY_KEY").filter(|value| !value.is_empty());
        let api_key = values.get("TG_CHAT_CENTRIFUGO_API_KEY").filter(|value| !value.is_empty());
        if proxy_key.is_none() && api_key.is_none() {
            return Ok(None);
        }
        let proxy_key =
            proxy_key.ok_or(AccountError::Validation("realtime proxy key is required"))?;
        let api_key = api_key.ok_or(AccountError::Validation("realtime API key is required"))?;
        if proxy_key.len() < MIN_SECRET_BYTES || api_key.len() < MIN_SECRET_BYTES {
            return Err(AccountError::Validation("realtime keys must contain at least 32 bytes"));
        }
        let endpoint =
            values.get("TG_CHAT_CENTRIFUGO_URL").map(String::as_str).unwrap_or(DEFAULT_ENDPOINT);
        let endpoint = url::Url::parse(endpoint)
            .map_err(|_| AccountError::Validation("invalid realtime URL"))?;
        let is_supported = matches!(endpoint.scheme(), "http" | "https")
            && endpoint.host_str().is_some()
            && endpoint.username().is_empty()
            && endpoint.password().is_none()
            && endpoint.query().is_none()
            && endpoint.fragment().is_none()
            && endpoint.path() == "/";
        if !is_supported {
            return Err(AccountError::Validation("realtime URL must be an HTTP service origin"));
        }

        Ok(Some(Self {
            endpoint,
            api_key: api_key.clone(),
            proxy_key: proxy_key.clone(),
            transport: HttpSettings::from_values(values)?,
        }))
    }
}
