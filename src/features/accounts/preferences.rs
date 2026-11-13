//! Versioned notification defaults and bundled sticker selection.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection, types::Json};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{AccountError, AccountService, Actor, sessions::lock_actor};
use crate::features::sticker_catalog;

const DEFAULT_NOTIFICATION_VOLUME: u8 = 50;
const MAX_NOTIFICATION_VOLUME: u8 = 100;

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct NotificationCategoryDefaults {
    pub should_notify: bool,
    pub should_show_preview: bool,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct NotificationDefaults {
    pub should_show_notifications: bool,
    pub should_show_offline_notifications: bool,
    pub should_play_sound: bool,
    pub should_play_sent_sound: bool,
    #[schema(maximum = 100)]
    pub volume: u8,
    pub private: NotificationCategoryDefaults,
    pub group: NotificationCategoryDefaults,
    pub channel: NotificationCategoryDefaults,
}

#[derive(Serialize, ToSchema)]
pub struct AccountPreferences {
    pub version: String,
    pub notification_defaults: NotificationDefaults,
    pub sticker_pack_ids: Vec<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AccountPreferenceChanges {
    pub expected_version: String,
    pub notification_defaults: Option<NotificationDefaults>,
    pub sticker_pack_ids: Option<Vec<String>>,
}

#[derive(FromRow)]
struct StoredPreferences {
    #[sqlx(json)]
    notification_defaults: NotificationDefaults,
    sticker_pack_ids: Vec<String>,
}

impl Default for NotificationCategoryDefaults {
    /// Enable alerts and preview for an account that has never changed this category.
    fn default() -> Self {
        Self {
            should_notify: true,
            should_show_preview: true,
        }
    }
}

impl Default for NotificationDefaults {
    /// Keep notification preferences consistent with the initial client defaults.
    fn default() -> Self {
        Self {
            should_show_notifications: true,
            should_show_offline_notifications: true,
            should_play_sound: true,
            should_play_sent_sound: true,
            volume: DEFAULT_NOTIFICATION_VOLUME,
            private: NotificationCategoryDefaults::default(),
            group: NotificationCategoryDefaults::default(),
            channel: NotificationCategoryDefaults::default(),
        }
    }
}

impl Default for StoredPreferences {
    /// Start an untouched account with the complete bundled catalogue.
    fn default() -> Self {
        Self {
            notification_defaults: NotificationDefaults::default(),
            sticker_pack_ids: sticker_catalog::pack_ids().to_vec(),
        }
    }
}

fn validate_pack_order(pack_ids: &[String]) -> Result<(), AccountError> {
    let catalog = sticker_catalog::pack_ids();
    if pack_ids.len() > catalog.len() {
        return Err(AccountError::Validation("sticker packs must be bundled and unique"));
    }

    let mut seen = HashSet::new();
    for pack_id in pack_ids {
        if !catalog.contains(pack_id) || !seen.insert(pack_id) {
            return Err(AccountError::Validation("sticker packs must be bundled and unique"));
        }
    }

    Ok(())
}

fn expected_version(input: &AccountPreferenceChanges) -> Result<i64, AccountError> {
    let version = input
        .expected_version
        .parse::<i64>()
        .map_err(|_| AccountError::Validation("invalid account settings version"))?;
    if version < 1 {
        return Err(AccountError::Validation("invalid account settings version"));
    }
    if input.notification_defaults.is_none() && input.sticker_pack_ids.is_none() {
        return Err(AccountError::Validation("at least one preference is required"));
    }
    let has_invalid_volume = input
        .notification_defaults
        .as_ref()
        .is_some_and(|defaults| defaults.volume > MAX_NOTIFICATION_VOLUME);
    if has_invalid_volume {
        return Err(AccountError::Validation("notification volume must be between 0 and 100"));
    }
    if let Some(pack_ids) = &input.sticker_pack_ids {
        validate_pack_order(pack_ids)?;
    }

    Ok(version)
}

/// Read the revision in the same authorized snapshot as its account state.
pub(crate) async fn settings_version(
    connection: &mut PgConnection,
    user_id: Uuid,
) -> Result<i64, AccountError> {
    let version = sqlx::query_scalar("SELECT account_settings_version FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(connection)
        .await?;

    Ok(version)
}

async fn read_preferences(
    connection: &mut PgConnection,
    user_id: Uuid,
) -> Result<StoredPreferences, AccountError> {
    let query = sqlx::query_as(
        "SELECT notification_defaults, sticker_pack_ids
         FROM account_preferences WHERE user_id = $1",
    )
    .bind(user_id);
    let mut preferences: StoredPreferences =
        query.fetch_optional(connection).await?.unwrap_or_default();

    // A catalogue removal should not force a client to resubmit an unsupported pack ID.
    let catalog = sticker_catalog::pack_ids();
    preferences.sticker_pack_ids.retain(|pack_id| catalog.contains(pack_id));

    Ok(preferences)
}

async fn save_preferences(
    connection: &mut PgConnection,
    user_id: Uuid,
    preferences: &StoredPreferences,
) -> Result<(), AccountError> {
    let save = sqlx::query(
        "INSERT INTO account_preferences (user_id, notification_defaults, sticker_pack_ids)
         VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET
             notification_defaults = EXCLUDED.notification_defaults,
             sticker_pack_ids = EXCLUDED.sticker_pack_ids",
    )
    .bind(user_id)
    .bind(Json(&preferences.notification_defaults));
    save.bind(&preferences.sticker_pack_ids).execute(connection).await?;

    Ok(())
}

fn view(preferences: StoredPreferences, version: i64) -> AccountPreferences {
    AccountPreferences {
        version: version.to_string(),
        notification_defaults: preferences.notification_defaults,
        sticker_pack_ids: preferences.sticker_pack_ids,
    }
}

impl AccountService {
    /// Return the current account's preferences together with their shared settings revision.
    pub async fn preferences(&self, actor: &Actor) -> Result<AccountPreferences, AccountError> {
        let mut transaction = self.pool.begin().await?;
        lock_actor(&mut transaction, actor, &self.settings).await?;
        let preferences = read_preferences(&mut transaction, actor.user_id).await?;
        let version = settings_version(&mut transaction, actor.user_id).await?;
        transaction.commit().await?;

        Ok(view(preferences, version))
    }

    /// Apply a partial preference update under the expected account settings revision.
    pub async fn update_preferences(
        &self,
        actor: &Actor,
        input: AccountPreferenceChanges,
    ) -> Result<AccountPreferences, AccountError> {
        let expected = expected_version(&input)?;
        let mut transaction = self.pool.begin().await?;
        lock_actor(&mut transaction, actor, &self.settings).await?;
        let version = settings_version(&mut transaction, actor.user_id).await?;
        if version != expected {
            return Err(AccountError::Conflict);
        }

        let mut preferences = read_preferences(&mut transaction, actor.user_id).await?;
        if let Some(defaults) = input.notification_defaults {
            preferences.notification_defaults = defaults;
        }
        if let Some(pack_ids) = input.sticker_pack_ids {
            preferences.sticker_pack_ids = pack_ids;
        }
        save_preferences(&mut transaction, actor.user_id, &preferences).await?;

        // Other settings mutations hold the same user row, so both updates commit as one revision.
        let advance = sqlx::query_scalar(
            "UPDATE users SET account_settings_version = account_settings_version + 1
             WHERE id = $1 RETURNING account_settings_version",
        )
        .bind(actor.user_id);
        let version = advance.fetch_one(&mut *transaction).await?;
        transaction.commit().await?;

        Ok(view(preferences, version))
    }
}
