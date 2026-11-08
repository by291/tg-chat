use std::collections::HashMap;

use super::AccountError;

const DEFAULT_SESSION_DAYS: i64 = 30;
const DEFAULT_IDLE_DAYS: i64 = 7;
const DEFAULT_RECENT_MINUTES: i64 = 10;
const DEFAULT_HASH_CONCURRENCY: usize = 4;
const DEFAULT_HASH_MEMORY_KIB: u32 = 19 * 1024;
const DEFAULT_HASH_ITERATIONS: u32 = 2;
const MAX_HASH_MEMORY_KIB: u32 = 256 * 1024;
const MAX_HASH_ITERATIONS: u32 = 10;

#[derive(Clone)]
pub struct AccountSettings {
    pub(crate) session_days: i64,
    pub(crate) idle_days: i64,
    pub(crate) recent_minutes: i64,
    pub(crate) hash_concurrency: usize,
    pub(crate) hash_memory_kib: u32,
    pub(crate) hash_iterations: u32,
}

impl Default for AccountSettings {
    fn default() -> Self {
        Self {
            session_days: DEFAULT_SESSION_DAYS,
            idle_days: DEFAULT_IDLE_DAYS,
            recent_minutes: DEFAULT_RECENT_MINUTES,
            hash_concurrency: DEFAULT_HASH_CONCURRENCY,
            hash_memory_kib: DEFAULT_HASH_MEMORY_KIB,
            hash_iterations: DEFAULT_HASH_ITERATIONS,
        }
    }
}

impl AccountSettings {
    /// Read bounded password costs while retaining explicit account lifecycle defaults.
    pub fn from_values(values: &HashMap<String, String>) -> Result<Self, AccountError> {
        let mut settings = Self::default();

        if let Some(memory) = values.get("TG_CHAT_PASSWORD_MEMORY_KIB") {
            settings.hash_memory_kib = memory.parse().map_err(|_| {
                AccountError::Validation("TG_CHAT_PASSWORD_MEMORY_KIB must be a bounded integer")
            })?;
        }

        if let Some(iterations) = values.get("TG_CHAT_PASSWORD_ITERATIONS") {
            settings.hash_iterations = iterations.parse().map_err(|_| {
                AccountError::Validation("TG_CHAT_PASSWORD_ITERATIONS must be a bounded integer")
            })?;
        }

        let is_memory_valid =
            (DEFAULT_HASH_MEMORY_KIB..=MAX_HASH_MEMORY_KIB).contains(&settings.hash_memory_kib);
        let are_iterations_valid =
            (DEFAULT_HASH_ITERATIONS..=MAX_HASH_ITERATIONS).contains(&settings.hash_iterations);
        if !is_memory_valid || !are_iterations_valid {
            return Err(AccountError::Validation(
                "password hashing costs are outside supported bounds",
            ));
        }

        Ok(settings)
    }
}
