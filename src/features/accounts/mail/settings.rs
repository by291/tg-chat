use std::{collections::HashMap, time::Duration};

use base64::{Engine, engine::general_purpose::STANDARD};
use lettre::{
    AsyncSmtpTransport, Tokio1Executor, message::Mailbox,
    transport::smtp::authentication::Credentials,
};

use crate::features::accounts::{AccountError, transport::HttpSettings};

const DEFAULT_SMTP_PORT: u16 = 587;
const SMTP_TIMEOUT: Duration = Duration::from_secs(20);
const KEY_BYTES: usize = 32;

pub struct MailSettings {
    pub(crate) origin: String,
    pub(crate) sender: Option<Mailbox>,
    pub(crate) transport: Option<lettre::transport::smtp::AsyncSmtpTransportBuilder>,
    pub(crate) key: Option<[u8; KEY_BYTES]>,
}

impl MailSettings {
    /// Enable mail only with a valid sender, encryption key, and explicit SMTP transport policy.
    pub fn from_values(values: &HashMap<String, String>) -> Result<Self, AccountError> {
        let origin = HttpSettings::from_values(values)?.origin;
        let Some(host) = values.get("TG_CHAT_SMTP_HOST").filter(|host| !host.is_empty()) else {
            return Ok(Self {
                origin,
                sender: None,
                transport: None,
                key: None,
            });
        };
        let sender = values.get("TG_CHAT_MAIL_FROM").ok_or(AccountError::Validation(
            "TG_CHAT_MAIL_FROM is required when SMTP is enabled",
        ))?;
        let sender = sender.parse().map_err(|_| AccountError::Validation("invalid mail sender"))?;
        let encoded_key = values
            .get("TG_CHAT_MAIL_KEY")
            .ok_or(AccountError::Validation("TG_CHAT_MAIL_KEY is required when SMTP is enabled"))?;
        let key = STANDARD
            .decode(encoded_key)
            .map_err(|_| AccountError::Validation("invalid mail encryption key"))?;
        let key: [u8; KEY_BYTES] = key
            .try_into()
            .map_err(|_| AccountError::Validation("mail encryption key must contain 32 bytes"))?;
        let configured_port =
            values.get("TG_CHAT_SMTP_PORT").map(|port| port.parse::<u16>()).transpose();
        let port = configured_port
            .map_err(|_| AccountError::Validation("invalid SMTP port"))?
            .unwrap_or(DEFAULT_SMTP_PORT);
        if port == 0 {
            return Err(AccountError::Validation("SMTP port must be positive"));
        }
        let mode = values.get("TG_CHAT_SMTP_MODE").map(String::as_str).unwrap_or("starttls");
        let is_local_capture =
            matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1" | "mailpit");
        let builder = match mode {
            "starttls" => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host),
            "tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(host),
            "plain" if is_local_capture => {
                Ok(AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host))
            }
            _ => {
                return Err(AccountError::Validation(
                    "SMTP mode must use TLS except for local capture",
                ));
            }
        };
        let mut builder =
            builder.map_err(|_| AccountError::Validation("invalid SMTP transport"))?;
        builder = builder.port(port).timeout(Some(SMTP_TIMEOUT));
        match (
            values.get("TG_CHAT_SMTP_USERNAME").filter(|value| !value.is_empty()),
            values.get("TG_CHAT_SMTP_PASSWORD").filter(|value| !value.is_empty()),
        ) {
            (Some(username), Some(password)) => {
                builder = builder.credentials(Credentials::new(username.clone(), password.clone()));
            }
            (None, None) => {}
            _ => {
                return Err(AccountError::Validation(
                    "SMTP credentials must include username and password",
                ));
            }
        }

        Ok(Self {
            origin,
            sender: Some(sender),
            transport: Some(builder),
            key: Some(key),
        })
    }
}
