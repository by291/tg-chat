use sqlx::PgPool;
use uuid::Uuid;

use super::{
    AccountError, AccountSettings, Actor, Login, PasswordChange, PrivateProfile, Registration,
    RevokeSession, SessionGrant, SessionView,
    credentials::{PasswordEngine, ensure_public_username, normalize_username, validate_text},
    model::UserRecord,
    sessions::{self, SessionCreation, SessionRecord, lock_actor},
};

const DISPLAY_NAME_LIMIT: usize = 80;
const DEVICE_NAME_LIMIT: usize = 100;

#[derive(Clone)]
pub struct AccountService {
    pub(crate) pool: PgPool,
    pub(crate) settings: AccountSettings,
    pub(crate) passwords: PasswordEngine,
}

fn registration_error(error: sqlx::Error) -> AccountError {
    let Some(database_error) = error.as_database_error() else {
        return AccountError::Unavailable;
    };
    if database_error.is_unique_violation() {
        return AccountError::UsernameUnavailable;
    }

    AccountError::Unavailable
}

impl AccountService {
    /// Share a bounded credential engine and authoritative PostgreSQL account state.
    pub fn new(pool: PgPool, settings: AccountSettings) -> Self {
        let passwords = PasswordEngine::new(&settings);

        Self {
            pool,
            settings,
            passwords,
        }
    }

    /// Atomically create a normalized account and its first opaque session.
    pub async fn register(&self, input: Registration) -> Result<SessionGrant, AccountError> {
        let username = normalize_username(&input.username)?;
        ensure_public_username(&username)?;
        let display_name = validate_text(&input.display_name, DISPLAY_NAME_LIMIT)?;
        let device_name = validate_text(&input.device_name, DEVICE_NAME_LIMIT)?;
        let password_hash = self.passwords.hash(input.password).await?;
        let mut transaction = self.pool.begin().await?;

        // Registration policy updates lock this same row; admission cannot race past closure.
        let is_open: bool =
            sqlx::query_scalar("SELECT is_open FROM registration_policy WHERE singleton FOR SHARE")
                .fetch_one(&mut *transaction)
                .await?;
        if !is_open {
            return Err(AccountError::RegistrationClosed);
        }

        let insert = sqlx::query_as::<_, UserRecord>(
            "INSERT INTO users (id, username, password_hash, display_name)
             VALUES ($1, $2, $3, $4) RETURNING *",
        )
        .bind(Uuid::new_v4())
        .bind(username);
        let insert = insert.bind(password_hash).bind(display_name);
        let user = insert.fetch_one(&mut *transaction).await.map_err(registration_error)?;
        let grant = sessions::create(
            &mut transaction,
            SessionCreation {
                user: &user,
                device_name: &device_name,
                settings: &self.settings,
            },
        )
        .await?;
        transaction.commit().await?;

        Ok(grant)
    }

    /// Verify credentials before locking and recheck the credential version before admission.
    pub async fn login(&self, input: Login) -> Result<SessionGrant, AccountError> {
        let username = normalize_username(&input.username).unwrap_or_default();
        let device_name = validate_text(&input.device_name, DEVICE_NAME_LIMIT)?;
        let snapshot_query =
            sqlx::query_as::<_, UserRecord>("SELECT * FROM users WHERE username = $1")
                .bind(username);
        let snapshot = snapshot_query.fetch_optional(&self.pool).await?;
        let encoded = snapshot.as_ref().map(|user| user.password_hash.clone());
        let is_password_valid = self.passwords.verify(input.password, encoded).await?;
        let snapshot = snapshot.ok_or(AccountError::InvalidCredentials)?;
        if !is_password_valid || snapshot.is_suspended {
            return Err(AccountError::InvalidCredentials);
        }

        let mut transaction = self.pool.begin().await?;
        let locked_query =
            sqlx::query_as::<_, UserRecord>("SELECT * FROM users WHERE id = $1 FOR UPDATE")
                .bind(snapshot.id);
        let user = locked_query.fetch_one(&mut *transaction).await?;
        let has_stale_credentials = user.credential_version != snapshot.credential_version;
        if user.is_suspended || has_stale_credentials {
            return Err(AccountError::InvalidCredentials);
        }

        let grant = sessions::create(
            &mut transaction,
            SessionCreation {
                user: &user,
                device_name: &device_name,
                settings: &self.settings,
            },
        )
        .await?;
        transaction.commit().await?;

        Ok(grant)
    }

    /// Authenticate every request against the current database revocation state.
    pub async fn authenticate(&self, token: &str) -> Result<Actor, AccountError> {
        sessions::authenticate(&self.pool, &self.settings, token).await
    }

    /// Return private profile fields only to the account that owns the current session.
    pub async fn profile(&self, actor: &Actor) -> Result<PrivateProfile, AccountError> {
        let mut transaction = self.pool.begin().await?;
        let (user, _) = lock_actor(&mut transaction, actor, &self.settings).await?;
        transaction.commit().await?;

        Ok(user.private_profile())
    }

    /// List only the caller's live sessions, marking the current device explicitly.
    pub async fn list_sessions(&self, actor: &Actor) -> Result<Vec<SessionView>, AccountError> {
        let mut transaction = self.pool.begin().await?;
        lock_actor(&mut transaction, actor, &self.settings).await?;
        let query = sqlx::query_as::<_, SessionRecord>(
            "SELECT * FROM sessions WHERE user_id = $1 AND revoked_at IS NULL
             AND expires_at > now()
             AND last_seen_at > now() - ($2::bigint * interval '1 day')
             ORDER BY created_at DESC",
        )
        .bind(actor.user_id)
        .bind(self.settings.idle_days);
        let sessions = query.fetch_all(&mut *transaction).await?;
        transaction.commit().await?;

        Ok(sessions.iter().map(|session| session.view(actor.session_id)).collect())
    }

    /// Revoke one account-owned session without disclosing another account's devices.
    pub async fn revoke_session(&self, input: RevokeSession) -> Result<(), AccountError> {
        let mut transaction = self.pool.begin().await?;
        let (_, current_session) =
            lock_actor(&mut transaction, &input.actor, &self.settings).await?;
        if input.session_id != input.actor.session_id {
            sessions::ensure_recent(&current_session, &self.settings)?;
        }
        let query = sqlx::query(
            "UPDATE sessions SET revoked_at = coalesce(revoked_at, now())
             WHERE id = $1 AND user_id = $2",
        )
        .bind(input.session_id)
        .bind(input.actor.user_id);
        let affected = query.execute(&mut *transaction).await?.rows_affected();
        if affected == 0 {
            return Err(AccountError::NotFound);
        }

        transaction.commit().await?;
        Ok(())
    }

    /// Revoke peer devices while preserving the authenticated caller's own session.
    pub async fn revoke_other_sessions(&self, actor: &Actor) -> Result<(), AccountError> {
        let mut transaction = self.pool.begin().await?;
        let (_, current_session) = lock_actor(&mut transaction, actor, &self.settings).await?;
        sessions::ensure_recent(&current_session, &self.settings)?;
        sqlx::query(
            "UPDATE sessions SET revoked_at = now()
             WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
        )
        .bind(actor.user_id)
        .bind(actor.session_id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;

        Ok(())
    }

    /// Refresh recent authentication only if the password and session remain current.
    pub async fn reauthenticate(
        &self,
        actor: &Actor,
        password: String,
    ) -> Result<(), AccountError> {
        let snapshot = self.password_snapshot(actor.user_id).await?;
        let is_valid =
            self.passwords.verify(password, Some(snapshot.password_hash.clone())).await?;
        if !is_valid {
            return Err(AccountError::InvalidCredentials);
        }

        let mut transaction = self.pool.begin().await?;
        let (user, _) = lock_actor(&mut transaction, actor, &self.settings).await?;
        if user.credential_version != snapshot.credential_version {
            return Err(AccountError::Conflict);
        }

        sqlx::query("UPDATE sessions SET authenticated_at = now() WHERE id = $1")
            .bind(actor.session_id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;

        Ok(())
    }

    /// Replace credentials atomically, revoke every old token, and issue a fresh current session.
    pub async fn change_password(
        &self,
        input: PasswordChange,
    ) -> Result<SessionGrant, AccountError> {
        let snapshot = self.password_snapshot(input.actor.user_id).await?;
        let is_valid = self
            .passwords
            .verify(input.current_password, Some(snapshot.password_hash.clone()))
            .await?;
        if !is_valid {
            return Err(AccountError::InvalidCredentials);
        }

        let password_hash = self.passwords.hash(input.new_password).await?;
        let mut transaction = self.pool.begin().await?;
        let (user, current_session) =
            lock_actor(&mut transaction, &input.actor, &self.settings).await?;
        if user.credential_version != snapshot.credential_version {
            return Err(AccountError::Conflict);
        }

        sqlx::query(
            "UPDATE users SET password_hash = $1, credential_version = credential_version + 1
             WHERE id = $2",
        )
        .bind(password_hash)
        .bind(user.id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        )
        .bind(user.id)
        .execute(&mut *transaction)
        .await?;
        let grant = sessions::create(
            &mut transaction,
            SessionCreation {
                user: &user,
                device_name: &current_session.device_name,
                settings: &self.settings,
            },
        )
        .await?;
        transaction.commit().await?;

        Ok(grant)
    }

    async fn password_snapshot(&self, user_id: Uuid) -> Result<UserRecord, AccountError> {
        let query =
            sqlx::query_as::<_, UserRecord>("SELECT * FROM users WHERE id = $1").bind(user_id);

        query.fetch_optional(&self.pool).await?.ok_or(AccountError::Unauthenticated)
    }
}
