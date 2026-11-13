use std::sync::Arc;

use argon2::{
    Algorithm, Argon2, Params, ParamsBuilder, Version,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;

use super::{AccountError, AccountSettings};

const MIN_PASSWORD_CHARACTERS: usize = 12;
const MAX_PASSWORD_BYTES: usize = 1024;
const TOKEN_BYTES: usize = 32;
const MIN_USERNAME_LENGTH: usize = 3;
const MAX_USERNAME_LENGTH: usize = 32;
const HASH_LANES: u32 = 1;
#[rustfmt::skip]
const RESERVED_USERNAMES: &[&str] = &[
    "admin",
    "administrator",
    "root",
    "system",
    "support",
    "deleted",
    "api",
    "worker",
];

#[derive(Clone)]
pub(crate) struct PasswordEngine {
    budget: Arc<Semaphore>,
    parameters: Params,
}

/// Normalize the immutable public identity while rejecting ambiguous or reserved names.
pub(crate) fn normalize_username(username: &str) -> Result<String, AccountError> {
    let has_valid_length = (MIN_USERNAME_LENGTH..=MAX_USERNAME_LENGTH).contains(&username.len());
    let has_valid_characters =
        username.bytes().all(|character| character.is_ascii_alphanumeric() || character == b'_');
    if !has_valid_length || !has_valid_characters {
        return Err(AccountError::Validation("use 3-32 ASCII letters, digits, or underscores"));
    }

    Ok(username.to_ascii_lowercase())
}

/// Reject names that would impersonate the service or its operator entry points.
pub(crate) fn ensure_public_username(username: &str) -> Result<(), AccountError> {
    if RESERVED_USERNAMES.contains(&username) {
        return Err(AccountError::UsernameUnavailable);
    }

    Ok(())
}

/// Validate the full password without trimming, normalization, or truncation.
pub(crate) fn validate_password(password: &str) -> Result<(), AccountError> {
    let has_valid_length =
        password.chars().count() >= MIN_PASSWORD_CHARACTERS && password.len() <= MAX_PASSWORD_BYTES;
    if !has_valid_length {
        return Err(AccountError::Validation(
            "passwords require 12 characters and at most 1024 UTF-8 bytes",
        ));
    }

    Ok(())
}

/// Bound human-readable fields before sending them to database constraints.
pub(crate) fn validate_text(value: &str, maximum: usize) -> Result<String, AccountError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > maximum {
        return Err(AccountError::Validation(
            "a text field is empty or exceeds its supported length",
        ));
    }

    Ok(trimmed.to_owned())
}

/// Generate an opaque token using operating-system randomness.
pub(crate) fn random_token() -> Result<String, AccountError> {
    let mut bytes = [0_u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes).map_err(|_| AccountError::Unavailable)?;

    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// Hash the cookie token with a separate domain from CSRF derivation.
pub(crate) fn session_hash(token: &str) -> Vec<u8> {
    let mut digest = Sha256::new();
    digest.update(b"tg-chat/session/");
    digest.update(token.as_bytes());

    digest.finalize().to_vec()
}

/// Derive a session-bound CSRF value without exposing the HttpOnly cookie token.
pub fn csrf_token(token: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"tg-chat/csrf/");
    digest.update(token.as_bytes());

    URL_SAFE_NO_PAD.encode(digest.finalize())
}

impl PasswordEngine {
    /// Construct a process-wide CPU/memory budget for password work.
    pub(crate) fn new(settings: &AccountSettings) -> Self {
        let mut builder = ParamsBuilder::new();
        builder.m_cost(settings.hash_memory_kib);
        builder.t_cost(settings.hash_iterations);
        builder.p_cost(HASH_LANES);
        let parameters = builder.build().expect("validated password hashing parameters");

        Self {
            budget: Arc::new(Semaphore::new(settings.hash_concurrency)),
            parameters,
        }
    }

    /// Hash the entire password outside Tokio's asynchronous worker threads.
    pub(crate) async fn hash(&self, password: String) -> Result<String, AccountError> {
        validate_password(&password)?;
        let permit =
            self.budget.clone().try_acquire_owned().map_err(|_| AccountError::Unavailable)?;
        let parameters = self.parameters.clone();

        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let algorithm = Argon2::new(Algorithm::Argon2id, Version::V0x13, parameters);
            let encoded = algorithm
                .hash_password(password.as_bytes())
                .map_err(|_| AccountError::Unavailable)?;

            Ok(encoded.to_string())
        })
        .await
        .map_err(|_| AccountError::Unavailable)?
    }

    /// Spend equivalent password work for missing identities before returning generic failure.
    pub(crate) async fn verify(
        &self,
        password: String,
        encoded: Option<String>,
    ) -> Result<bool, AccountError> {
        if password.len() > MAX_PASSWORD_BYTES {
            return Err(AccountError::InvalidCredentials);
        }

        let permit =
            self.budget.clone().try_acquire_owned().map_err(|_| AccountError::Unavailable)?;
        let parameters = self.parameters.clone();

        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let algorithm = Argon2::new(Algorithm::Argon2id, Version::V0x13, parameters);
            let Some(encoded) = encoded else {
                algorithm
                    .hash_password(password.as_bytes())
                    .map_err(|_| AccountError::Unavailable)?;
                return Ok(false);
            };
            let parsed = PasswordHash::new(&encoded).map_err(|_| AccountError::Unavailable)?;

            Ok(algorithm.verify_password(password.as_bytes(), &parsed).is_ok())
        })
        .await
        .map_err(|_| AccountError::Unavailable)?
    }
}
