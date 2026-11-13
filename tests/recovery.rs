mod support;

use std::collections::HashMap;

use sqlx::PgPool;
use tg_chat::features::{
    accounts::mail::{MailQueue, MailSettings},
    accounts::{
        AccountError, AccountService, AccountSettings, Login, PasswordChange,
        email::{EmailService, PasswordReset},
    },
};

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn disabled_smtp_does_not_create_challenges_or_claim_to_send_mail(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let actor = support::account(&accounts, "alice").await;
    let queue =
        MailQueue::new(pool.clone(), MailSettings::from_values(&HashMap::new()).unwrap()).unwrap();
    let email = EmailService::new(accounts, queue);
    let outcome = email.request_verification(&actor, "alice@example.test".to_owned()).await;
    assert!(matches!(outcome, Err(AccountError::EmailUnavailable)));
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM email_challenges").fetch_one(&pool).await.unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn verification_preserves_old_email_until_confirmation_and_consumes_tokens_once(
    pool: PgPool,
) {
    let (accounts, queue, email) = support::services(pool.clone());
    let alice = support::account(&accounts, "alice").await;
    email.request_verification(&alice, "alice@example.test".to_owned()).await.unwrap();
    let token = support::mailed_token(&queue).await;
    let (first, second) = tokio::join!(email.confirm(token.clone()), email.confirm(token.clone()));
    assert_ne!(first.is_ok(), second.is_ok());
    assert_eq!(
        accounts.profile(&alice).await.unwrap().email.as_deref(),
        Some("alice@example.test")
    );

    email.request_verification(&alice, "replacement@example.test".to_owned()).await.unwrap();
    assert_eq!(
        accounts.profile(&alice).await.unwrap().email.as_deref(),
        Some("alice@example.test")
    );
    let replacement = support::mailed_token(&queue).await;
    email.confirm(replacement).await.unwrap();
    assert_eq!(
        accounts.profile(&alice).await.unwrap().email.as_deref(),
        Some("replacement@example.test")
    );
    let bobby = support::account(&accounts, "bobby").await;
    email.request_verification(&bobby, "replacement@example.test".to_owned()).await.unwrap();
    let duplicate = support::mailed_token(&queue).await;
    assert!(matches!(
        email.confirm(duplicate).await,
        Err(AccountError::EmailUnavailableForAccount)
    ));
    assert!(accounts.profile(&bobby).await.unwrap().email.is_none());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn recovery_is_single_use_and_revokes_every_existing_session(pool: PgPool) {
    let (accounts, queue, email) = support::services(pool);
    let alice = support::account(&accounts, "alice").await;
    email.request_verification(&alice, "alice@example.test".to_owned()).await.unwrap();
    email.confirm(support::mailed_token(&queue).await).await.unwrap();
    let peer = accounts
        .login(Login {
            username: "alice".to_owned(),
            password: "a complete password phrase".to_owned(),
            device_name: "Other browser".to_owned(),
        })
        .await
        .unwrap();
    email.request_recovery("unknown@example.test".to_owned()).await.unwrap();
    assert!(queue.claim().await.unwrap().is_none());
    email.request_recovery("alice@example.test".to_owned()).await.unwrap();
    let token = support::mailed_token(&queue).await;
    let (first, second) = tokio::join!(
        email.reset_password(PasswordReset {
            token: token.clone(),
            new_password: "a replacement password phrase".to_owned(),
        }),
        email.reset_password(PasswordReset {
            token,
            new_password: "a replacement password phrase".to_owned(),
        }),
    );
    assert_ne!(first.is_ok(), second.is_ok());
    assert!(accounts.authenticate(&peer.token).await.is_err());
    assert!(accounts.profile(&alice).await.is_err());
    assert!(
        accounts
            .login(Login {
                username: "alice".to_owned(),
                password: "a replacement password phrase".to_owned(),
                device_name: "New browser".to_owned(),
            })
            .await
            .is_ok()
    );
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn password_changes_and_email_removal_invalidate_outstanding_challenges(pool: PgPool) {
    let (accounts, queue, email) = support::services(pool);
    let alice = support::account(&accounts, "alice").await;
    email.request_verification(&alice, "alice@example.test".to_owned()).await.unwrap();
    let token = support::mailed_token(&queue).await;
    let grant = accounts
        .change_password(PasswordChange {
            actor: alice,
            current_password: "a complete password phrase".to_owned(),
            new_password: "a replacement password phrase".to_owned(),
        })
        .await
        .unwrap();
    assert!(email.confirm(token).await.is_err());
    let alice = accounts.authenticate(&grant.token).await.unwrap();
    email.request_verification(&alice, "alice@example.test".to_owned()).await.unwrap();
    email.confirm(support::mailed_token(&queue).await).await.unwrap();
    email.request_recovery("alice@example.test".to_owned()).await.unwrap();
    let recovery = support::mailed_token(&queue).await;
    email.remove(&alice).await.unwrap();
    assert!(
        email
            .reset_password(PasswordReset {
                token: recovery,
                new_password: "a third complete password phrase".to_owned(),
            })
            .await
            .is_err()
    );
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn concurrent_email_confirmations_preserve_unique_ownership(pool: PgPool) {
    let (accounts, queue, email) = support::services(pool);
    let alice = support::account(&accounts, "alice").await;
    let bobby = support::account(&accounts, "bobby").await;
    email.request_verification(&alice, "shared@example.test".to_owned()).await.unwrap();
    let first = support::mailed_token(&queue).await;
    email.request_verification(&bobby, "shared@example.test".to_owned()).await.unwrap();
    let second = support::mailed_token(&queue).await;
    let (first, second) = tokio::join!(email.confirm(first), email.confirm(second));
    assert_ne!(first.is_ok(), second.is_ok());
    let alice_email = accounts.profile(&alice).await.unwrap().email;
    let bobby_email = accounts.profile(&bobby).await.unwrap().email;
    assert_ne!(alice_email.is_some(), bobby_email.is_some());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn expired_links_and_stale_email_authentication_are_rejected(pool: PgPool) {
    let (accounts, queue, email) = support::services(pool.clone());
    let alice = support::account(&accounts, "alice").await;
    email.request_verification(&alice, "alice@example.test".to_owned()).await.unwrap();
    let token = support::mailed_token(&queue).await;
    sqlx::query("UPDATE email_challenges SET expires_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(email.confirm(token).await, Err(AccountError::InvalidChallenge)));
    sqlx::query("UPDATE sessions SET authenticated_at = now() - interval '15 minutes'")
        .execute(&pool)
        .await
        .unwrap();
    let pending = email.request_verification(&alice, "other@example.test".to_owned()).await;
    assert!(matches!(pending, Err(AccountError::RecentAuthenticationRequired)));
    assert!(matches!(email.remove(&alice).await, Err(AccountError::RecentAuthenticationRequired)));
}
