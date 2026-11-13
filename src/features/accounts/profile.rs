use serde::Deserialize;
use utoipa::ToSchema;

use super::{
    AccountError, AccountService, Actor, PrivateProfile, credentials::validate_text,
    model::UserRecord, sessions::lock_actor,
};

use crate::features::media::{
    SetAvatar,
    avatars::{AvatarChange, prepare_avatar},
};

const DISPLAY_NAME_LIMIT: usize = 80;
const BIOGRAPHY_LIMIT: usize = 500;
const PHONE_LIMIT: usize = 40;

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ProfileUpdate {
    pub version: String,
    pub display_name: String,
    pub biography: String,
    pub phone: Option<String>,
}

impl AccountService {
    /// Replace editable account fields only when the submitted profile version is still current.
    pub async fn update_profile(
        &self,
        actor: &Actor,
        input: ProfileUpdate,
    ) -> Result<PrivateProfile, AccountError> {
        let display_name = validate_text(&input.display_name, DISPLAY_NAME_LIMIT)?;
        let biography = input.biography.trim();
        let phone = input.phone.as_deref().map(str::trim).filter(|phone| !phone.is_empty());
        let is_biography_valid = biography.chars().count() <= BIOGRAPHY_LIMIT;
        let is_phone_valid = phone.is_none_or(|phone| phone.chars().count() <= PHONE_LIMIT);
        if !is_biography_valid || !is_phone_valid {
            return Err(AccountError::Validation("profile text exceeds the supported length"));
        }
        let version: i64 = input
            .version
            .parse()
            .map_err(|_| AccountError::Validation("invalid profile version"))?;

        let mut transaction = self.pool.begin().await?;
        let (user, _) = lock_actor(&mut transaction, actor, &self.settings).await?;
        if version != user.profile_version {
            return Err(AccountError::Conflict);
        }
        let update = sqlx::query_as::<_, UserRecord>(
            "UPDATE users SET display_name = $1, biography = $2, phone = $3,
             profile_version = profile_version + 1 WHERE id = $4 RETURNING *",
        )
        .bind(display_name)
        .bind(biography);
        let update = update.bind(phone).bind(actor.user_id);
        let user = update.fetch_one(&mut *transaction).await?;
        transaction.commit().await?;

        Ok(user.private_profile())
    }

    /// Assign or remove a validated avatar with version checking and a replay receipt.
    pub async fn set_avatar(
        &self,
        actor: &Actor,
        input: SetAvatar,
    ) -> Result<PrivateProfile, AccountError> {
        let version = input
            .expected_version
            .parse::<i64>()
            .map_err(|_| AccountError::Validation("invalid profile version"))?;
        let mut transaction = self.pool.begin().await?;
        let (user, _) = lock_actor(&mut transaction, actor, &self.settings).await?;
        let receipt = sqlx::query_as::<_, (i64, Option<uuid::Uuid>)>(
            "SELECT expected_version, file_id FROM media_avatar_receipts
             WHERE owner_id = $1 AND operation_id = $2",
        )
        .bind(actor.user_id)
        .bind(input.operation_id);
        if let Some(receipt) = receipt.fetch_optional(&mut *transaction).await? {
            if receipt != (version, input.file_id) {
                return Err(AccountError::Conflict);
            }
            return Ok(user.private_profile());
        }
        if version != user.profile_version {
            return Err(AccountError::Conflict);
        }

        prepare_avatar(
            &mut transaction,
            AvatarChange {
                actor_id: actor.user_id,
                previous: user.avatar_file_id,
                next: input.file_id,
            },
        )
        .await?;
        let update = sqlx::query_as::<_, UserRecord>(
            "UPDATE users SET avatar_file_id = $2, profile_version = profile_version + 1
             WHERE id = $1 RETURNING *",
        )
        .bind(actor.user_id)
        .bind(input.file_id);
        let updated = update.fetch_one(&mut *transaction).await?;

        let save_receipt = sqlx::query(
            "INSERT INTO media_avatar_receipts (owner_id, operation_id, expected_version, file_id)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(actor.user_id)
        .bind(input.operation_id)
        .bind(version);
        let save_receipt = save_receipt.bind(input.file_id);
        save_receipt.execute(&mut *transaction).await?;
        transaction.commit().await?;

        Ok(updated.private_profile())
    }
}
