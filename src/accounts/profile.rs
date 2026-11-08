use serde::Deserialize;
use utoipa::ToSchema;

use super::{
    AccountError, AccountService, Actor, PrivateProfile, credentials::validate_text,
    model::UserRecord, sessions::lock_actor,
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
}
