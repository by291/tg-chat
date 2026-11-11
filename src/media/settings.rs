const MEBIBYTE: i64 = 1024 * 1024;
const GIBIBYTE: i64 = 1024 * MEBIBYTE;

pub(super) const IMAGE_BYTES: i64 = 25 * MEBIBYTE;
pub(super) const VOICE_BYTES: i64 = 25 * MEBIBYTE;
pub(super) const DOCUMENT_BYTES: i64 = 100 * MEBIBYTE;
pub(super) const PART_BYTES: i64 = 8 * MEBIBYTE;
pub(super) const RESERVATION_SECONDS: i64 = 24 * 60 * 60;

pub(super) const WRITE_SECONDS: i64 = 15 * 60;
pub(super) const CLAIM_SECONDS: i64 = 90;
pub(super) const MAX_TRANSFER_PARTS: usize = 13;

const DEFAULT_ACTIVE_UPLOADS: i64 = 20;

#[derive(Clone, Debug)]
pub struct MediaLimits {
    pub account_bytes: i64,
    pub staging_bytes: i64,
    pub active_uploads_per_account: i64,
}

#[derive(Clone)]
pub struct MediaStorageSettings {
    pub internal_endpoint: String,
    pub public_endpoint: String,
    pub access_key: String,
    pub secret_key: String,
    pub browser_origin: String,
    pub bucket: String,
}

impl Default for MediaLimits {
    fn default() -> Self {
        Self {
            account_bytes: GIBIBYTE,
            staging_bytes: 512 * MEBIBYTE,
            active_uploads_per_account: DEFAULT_ACTIVE_UPLOADS,
        }
    }
}

impl MediaStorageSettings {
    /// Enable media only when the deployment supplies its private S3 configuration.
    pub(crate) fn from_env() -> Result<Option<Self>, crate::accounts::AccountError> {
        match std::env::var("TG_CHAT_MEDIA_ENABLED").as_deref() {
            Err(std::env::VarError::NotPresent) | Ok("false") => return Ok(None),
            Ok("true") => {}
            _ => return Err(crate::accounts::AccountError::Validation("invalid media setting")),
        }

        let internal_endpoint = setting("TG_CHAT_S3_INTERNAL_ENDPOINT")?;
        let public_endpoint = setting("TG_CHAT_S3_PUBLIC_ENDPOINT")?;
        let browser_origin = setting("TG_CHAT_PUBLIC_ORIGIN")?;
        for endpoint in [&internal_endpoint, &public_endpoint, &browser_origin] {
            validate_origin(endpoint)?;
        }

        Ok(Some(Self {
            internal_endpoint,
            public_endpoint,
            browser_origin,
            access_key: setting("TG_CHAT_S3_ACCESS_KEY")?,
            secret_key: setting("TG_CHAT_S3_SECRET_KEY")?,
            bucket: "tg-chat-media".to_owned(),
        }))
    }
}

fn setting(name: &'static str) -> Result<String, crate::accounts::AccountError> {
    let value = std::env::var(name)
        .map_err(|_| crate::accounts::AccountError::Validation("missing media setting"))?;
    if value.is_empty() {
        return Err(crate::accounts::AccountError::Validation("empty media setting"));
    }

    Ok(value)
}

fn validate_origin(value: &str) -> Result<(), crate::accounts::AccountError> {
    use crate::accounts::AccountError;

    let origin =
        url::Url::parse(value).map_err(|_| AccountError::Validation("invalid media endpoint"))?;
    let is_valid = matches!(origin.scheme(), "http" | "https")
        && origin.host().is_some()
        && origin.username().is_empty()
        && origin.password().is_none()
        && origin.path() == "/"
        && origin.query().is_none()
        && origin.fragment().is_none();
    if !is_valid {
        return Err(AccountError::Validation("invalid media endpoint"));
    }

    Ok(())
}

impl MediaLimits {
    /// Load the deployment staging ceiling while keeping the agreed per-account limit.
    pub(crate) fn from_env() -> Result<Self, crate::accounts::AccountError> {
        use crate::accounts::AccountError;

        let mut limits = Self::default();
        let raw = match std::env::var("TG_CHAT_MEDIA_STAGING_BYTES") {
            Ok(raw) => raw,
            Err(std::env::VarError::NotPresent) => return Ok(limits),
            Err(_) => return Err(AccountError::Validation("invalid media staging budget")),
        };
        let bytes = raw
            .parse::<i64>()
            .map_err(|_| AccountError::Validation("invalid media staging budget"))?;
        if bytes <= 0 {
            return Err(AccountError::Validation("invalid media staging budget"));
        }
        limits.staging_bytes = bytes;

        Ok(limits)
    }
}
