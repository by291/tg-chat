use std::time::Duration;

use sqlx::PgPool;
use tg_chat::accounts::{
    AccountError, AccountService, AccountSettings, Login, PasswordChange, Registration,
    RevokeSession,
};

const PASSWORD: &str = "a sufficiently long password";
const LOCK_OBSERVATION_INTERVAL: Duration = Duration::from_millis(20);
const LOCK_WAIT_TIMEOUT: Duration = Duration::from_secs(10);

fn registration(username: &str) -> Registration {
    Registration {
        username: username.to_owned(),
        password: PASSWORD.to_owned(),
        display_name: "Account owner".to_owned(),
        device_name: "First browser".to_owned(),
    }
}

fn login(username: &str) -> Login {
    Login {
        username: username.to_owned(),
        password: PASSWORD.to_owned(),
        device_name: "Second browser".to_owned(),
    }
}

#[sqlx::test]
#[ignore = "requires isolated PostgreSQL through DATABASE_URL"]
async fn normalized_registration_races_create_one_identity(pool: PgPool) {
    let service = AccountService::new(pool.clone(), AccountSettings::default());
    let (first, second) = tokio::join!(
        service.register(registration("Alice")),
        service.register(registration("ALICE")),
    );

    assert_ne!(first.is_ok(), second.is_ok());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM users WHERE username = 'alice'")
        .fetch_one(&pool)
        .await
        .expect("stored identity");
    assert_eq!(count, 1);

    let session = service.login(login("aLiCe")).await.expect("case-insensitive login");
    assert_eq!(session.user.username, "alice");
}

#[sqlx::test]
#[ignore = "requires isolated PostgreSQL through DATABASE_URL"]
async fn unicode_passwords_are_verified_without_truncation(pool: PgPool) {
    let service = AccountService::new(pool, AccountSettings::default());
    let password = "Long Unicode phrase 密码 🦀 ".repeat(12);
    let mut input = registration("unicode_user");
    input.password = password.clone();
    service.register(input).await.expect("long Unicode registration");

    let mut credentials = login("unicode_user");
    credentials.password = password.clone();
    service.login(credentials).await.expect("exact password accepted");

    let mut different = login("unicode_user");
    different.password = format!("{password}different suffix");
    assert!(matches!(service.login(different).await, Err(AccountError::InvalidCredentials)));
    assert!(matches!(
        service.login(login("missing_user")).await,
        Err(AccountError::InvalidCredentials)
    ));
}

#[sqlx::test]
#[ignore = "requires isolated PostgreSQL through DATABASE_URL"]
async fn sessions_revoke_independently_and_remain_account_owned(pool: PgPool) {
    let service = AccountService::new(pool, AccountSettings::default());
    let first = service.register(registration("alice")).await.expect("first account");
    let second = service.login(login("alice")).await.expect("second session");
    let other = service.register(registration("bob")).await.expect("other account");
    let actor = service.authenticate(&first.token).await.expect("actor");

    let foreign = RevokeSession {
        actor: actor.clone(),
        session_id: other.session.id,
    };
    assert!(matches!(service.revoke_session(foreign).await, Err(AccountError::NotFound)));

    service
        .revoke_session(RevokeSession {
            actor: actor.clone(),
            session_id: second.session.id,
        })
        .await
        .expect("revoke own second session");
    assert!(matches!(
        service.authenticate(&second.token).await,
        Err(AccountError::Unauthenticated)
    ));
    assert!(service.authenticate(&first.token).await.is_ok());
    assert!(service.authenticate(&other.token).await.is_ok());
    assert_eq!(service.list_sessions(&actor).await.expect("sessions").len(), 1);
}

#[sqlx::test]
#[ignore = "requires isolated PostgreSQL through DATABASE_URL"]
async fn password_change_rotates_current_session_and_revokes_peers(pool: PgPool) {
    let service = AccountService::new(pool, AccountSettings::default());
    let first = service.register(registration("alice")).await.expect("account");
    let peer = service.login(login("alice")).await.expect("peer session");
    let actor = service.authenticate(&first.token).await.expect("actor");
    let changed = service
        .change_password(PasswordChange {
            actor,
            current_password: PASSWORD.to_owned(),
            new_password: "a replacement password with Unicode 密码".to_owned(),
        })
        .await
        .expect("password change");

    assert!(service.authenticate(&first.token).await.is_err());
    assert!(service.authenticate(&peer.token).await.is_err());
    assert!(service.authenticate(&changed.token).await.is_ok());
    assert_ne!(first.csrf_token, changed.csrf_token);
    assert!(matches!(service.login(login("alice")).await, Err(AccountError::InvalidCredentials)));
}

#[sqlx::test]
#[ignore = "requires isolated PostgreSQL through DATABASE_URL"]
async fn expired_and_suspended_sessions_fail_authentication(pool: PgPool) {
    let service = AccountService::new(pool.clone(), AccountSettings::default());
    let expired = service.register(registration("expired_user")).await.expect("account");
    sqlx::query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1")
        .bind(expired.session.id)
        .execute(&pool)
        .await
        .expect("expire session");
    assert!(matches!(
        service.authenticate(&expired.token).await,
        Err(AccountError::Unauthenticated)
    ));

    let suspended = service.register(registration("suspended_user")).await.expect("account");
    sqlx::query("UPDATE users SET is_suspended = true WHERE id = $1")
        .bind(suspended.user.id)
        .execute(&pool)
        .await
        .expect("suspend account");
    assert!(service.authenticate(&suspended.token).await.is_err());
    assert!(matches!(
        service.login(login("suspended_user")).await,
        Err(AccountError::InvalidCredentials)
    ));
}

#[sqlx::test]
#[ignore = "requires isolated PostgreSQL through DATABASE_URL"]
async fn stale_authentication_requires_password_before_revoking_peer_devices(pool: PgPool) {
    let service = AccountService::new(pool.clone(), AccountSettings::default());
    let current = service.register(registration("alice")).await.expect("account");
    let peer = service.login(login("alice")).await.expect("peer");
    let actor = service.authenticate(&current.token).await.expect("actor");
    sqlx::query(
        "UPDATE sessions SET authenticated_at = now() - interval '15 minutes' WHERE id = $1",
    )
    .bind(current.session.id)
    .execute(&pool)
    .await
    .expect("age authentication");

    assert!(matches!(
        service.revoke_other_sessions(&actor).await,
        Err(AccountError::RecentAuthenticationRequired)
    ));
    service.reauthenticate(&actor, PASSWORD.to_owned()).await.expect("fresh password proof");
    service.revoke_other_sessions(&actor).await.expect("revoke peers");
    assert!(service.authenticate(&peer.token).await.is_err());
    assert!(service.authenticate(&current.token).await.is_ok());
}

async fn wait_for_blocked_admission(pool: &PgPool) {
    let waiting = async {
        loop {
            let is_waiting: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                 WHERE datname = current_database() AND wait_event_type = 'Lock')",
            )
            .fetch_one(pool)
            .await
            .expect("database lock state");
            if is_waiting {
                return;
            }

            tokio::time::sleep(LOCK_OBSERVATION_INTERVAL).await;
        }
    };

    tokio::time::timeout(LOCK_WAIT_TIMEOUT, waiting)
        .await
        .expect("login reaches the serialized admission boundary");
}

#[sqlx::test]
#[ignore = "requires isolated PostgreSQL through DATABASE_URL"]
async fn password_replacement_during_login_rejects_the_old_verified_password(pool: PgPool) {
    let service = AccountService::new(pool.clone(), AccountSettings::default());
    let original = service.register(registration("alice")).await.expect("account");
    let mut replacement = registration("replacement");
    replacement.password = "a completely different password".to_owned();
    service.register(replacement).await.expect("replacement credential fixture");

    let mut transaction = pool.begin().await.expect("transaction");
    sqlx::query("SELECT id FROM users WHERE id = $1 FOR UPDATE")
        .bind(original.user.id)
        .execute(&mut *transaction)
        .await
        .expect("serialize credential replacement");
    let logging_in = service.clone();
    let admission = tokio::spawn(async move { logging_in.login(login("alice")).await });
    wait_for_blocked_admission(&pool).await;

    sqlx::query(
        "UPDATE users SET credential_version = credential_version + 1,
         password_hash = (SELECT password_hash FROM users WHERE username = 'replacement')
         WHERE id = $1",
    )
    .bind(original.user.id)
    .execute(&mut *transaction)
    .await
    .expect("replace credentials before login admission");
    transaction.commit().await.expect("commit replacement");

    assert!(matches!(admission.await.expect("login task"), Err(AccountError::InvalidCredentials)));
}
