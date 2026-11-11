use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgConnection, PgPool};
use uuid::Uuid;

use super::{
    AccountError, AccountSettings, Actor, SessionGrant, SessionView,
    credentials::{csrf_token, random_token, session_hash},
    model::UserRecord,
};

const MAX_ACTIVE_SESSIONS: i64 = 100;
const TOKEN_LENGTH: usize = 43;
const ACTIVITY_WRITE_MINUTES: i64 = 5;

#[derive(FromRow)]
pub(crate) struct SessionRecord {
    pub id: Uuid,
    pub device_name: String,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub authenticated_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

pub(crate) struct SessionCreation<'a> {
    pub user: &'a UserRecord,
    pub device_name: &'a str,
    pub settings: &'a AccountSettings,
}

impl SessionRecord {
    /// Render device metadata with ownership relative to the requesting session.
    pub(crate) fn view(&self, current_session_id: Uuid) -> SessionView {
        SessionView {
            id: self.id,
            device_name: self.device_name.clone(),
            created_at: self.created_at,
            last_seen_at: self.last_seen_at,
            expires_at: self.expires_at,
            is_current: self.id == current_session_id,
        }
    }
}

/// Check authoritative account/session state and coalesce activity updates.
pub(crate) async fn authenticate(
    pool: &PgPool,
    settings: &AccountSettings,
    token: &str,
) -> Result<Actor, AccountError> {
    if token.len() != TOKEN_LENGTH {
        return Err(AccountError::Unauthenticated);
    }

    let actor = sqlx::query_as::<_, Actor>(
        "SELECT users.id AS user_id, sessions.id AS session_id
         FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = $1 AND sessions.revoked_at IS NULL
           AND sessions.expires_at > now()
           AND sessions.last_seen_at > now() - ($2::bigint * interval '1 day')
           AND NOT users.is_suspended",
    )
    .bind(session_hash(token))
    .bind(settings.idle_days);
    let actor = actor.fetch_optional(pool).await?.ok_or(AccountError::Unauthenticated)?;

    sqlx::query(
        "UPDATE sessions SET last_seen_at = now()
         WHERE id = $1 AND last_seen_at < now() - ($2::bigint * interval '1 minute')",
    )
    .bind(actor.session_id)
    .bind(ACTIVITY_WRITE_MINUTES)
    .execute(pool)
    .await?;

    Ok(actor)
}

/// Lock the account before its session so sensitive writes share one revocation boundary.
pub(crate) async fn lock_actor(
    connection: &mut PgConnection,
    actor: &Actor,
    settings: &AccountSettings,
) -> Result<(UserRecord, SessionRecord), AccountError> {
    let user_query =
        sqlx::query_as::<_, UserRecord>("SELECT * FROM users WHERE id = $1 FOR UPDATE")
            .bind(actor.user_id);
    let user =
        user_query.fetch_optional(&mut *connection).await?.ok_or(AccountError::Unauthenticated)?;
    if user.is_suspended {
        return Err(AccountError::Unauthenticated);
    }

    // Evaluate validity after locking so an expired session cannot survive a lock wait.
    let session_query = sqlx::query_as::<_, SessionRecord>(
        "WITH locked_session AS MATERIALIZED (
             SELECT * FROM sessions WHERE id = $1 AND user_id = $2 FOR UPDATE
         )
         SELECT * FROM locked_session WHERE revoked_at IS NULL
           AND expires_at > clock_timestamp()
           AND last_seen_at > clock_timestamp() - ($3::bigint * interval '1 day')",
    )
    .bind(actor.session_id)
    .bind(actor.user_id);
    let session_query = session_query.bind(settings.idle_days);
    let session = session_query
        .fetch_optional(&mut *connection)
        .await?
        .ok_or(AccountError::Unauthenticated)?;

    Ok((user, session))
}

/// Require recent password authentication while the session row remains locked.
pub(crate) fn ensure_recent(
    session: &SessionRecord,
    settings: &AccountSettings,
) -> Result<(), AccountError> {
    let threshold = Utc::now() - chrono::Duration::minutes(settings.recent_minutes);
    if session.authenticated_at < threshold {
        return Err(AccountError::RecentAuthenticationRequired);
    }

    Ok(())
}

/// Revoke live sessions while the account lock prevents concurrent session admission.
pub(crate) async fn revoke_all(
    connection: &mut PgConnection,
    user_id: Uuid,
) -> Result<(), AccountError> {
    sqlx::query(
        "UPDATE sessions SET revoked_at = clock_timestamp()
         WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .execute(connection)
    .await?;

    Ok(())
}

/// Admit a session while its caller owns the user-row lock, preventing capacity races.
pub(crate) async fn create(
    connection: &mut PgConnection,
    creation: SessionCreation<'_>,
) -> Result<SessionGrant, AccountError> {
    let active_query = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM sessions WHERE user_id = $1
           AND revoked_at IS NULL AND expires_at > now()
           AND last_seen_at > now() - ($2::bigint * interval '1 day')",
    )
    .bind(creation.user.id)
    .bind(creation.settings.idle_days);
    let active_sessions = active_query.fetch_one(&mut *connection).await?;
    if active_sessions >= MAX_ACTIVE_SESSIONS {
        return Err(AccountError::QuotaExceeded);
    }

    let token = random_token()?;
    let session_id = Uuid::new_v4();
    let insert = sqlx::query_as::<_, SessionRecord>(
        "INSERT INTO sessions (id, user_id, token_hash, device_name, expires_at)
         VALUES ($1, $2, $3, $4, now() + ($5::bigint * interval '1 day')) RETURNING *",
    )
    .bind(session_id)
    .bind(creation.user.id);
    let insert = insert
        .bind(session_hash(&token))
        .bind(creation.device_name)
        .bind(creation.settings.session_days);
    let stored = insert.fetch_one(&mut *connection).await?;

    Ok(SessionGrant {
        user: creation.user.private_profile(),
        session: stored.view(session_id),
        csrf_token: csrf_token(&token),
        token,
    })
}
