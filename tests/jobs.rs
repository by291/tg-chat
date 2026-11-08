mod support;

use base64::{Engine, engine::general_purpose::STANDARD};
use sqlx::PgPool;
use tg_chat::{accounts::AccountError, jobs::DeliveryOutcome};

const VALID_MAIL_KEY: [u8; 32] = [37; 32];

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn competing_claims_and_reclaimed_leases_fence_stale_workers(pool: PgPool) {
    let (accounts, queue, email) = support::services(pool.clone());
    let alice = support::account(&accounts, "alice").await;
    email.request_verification(&alice, "alice@example.test".to_owned()).await.unwrap();
    let (first, second) = tokio::join!(queue.claim(), queue.claim());
    let first = first.unwrap();
    let second = second.unwrap();
    assert_ne!(first.is_some(), second.is_some());
    let stale = first.or(second).unwrap();
    sqlx::query("UPDATE mail_jobs SET lease_until = now() - interval '1 second' WHERE id = $1")
        .bind(stale.id)
        .execute(&pool)
        .await
        .unwrap();
    let current = queue.claim().await.unwrap().unwrap();
    assert_eq!(stale.id, current.id);
    assert!(!queue.finish(&stale, DeliveryOutcome::Sent).await.unwrap());
    assert!(queue.finish(&current, DeliveryOutcome::Sent).await.unwrap());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn encrypted_payloads_bind_job_identity_and_expired_challenges_are_not_delivered(
    pool: PgPool,
) {
    let (accounts, queue, email) = support::services(pool.clone());
    let alice = support::account(&accounts, "alice").await;
    email.request_verification(&alice, "alice@example.test".to_owned()).await.unwrap();
    let claim = queue.claim().await.unwrap().unwrap();
    let outgoing = queue.prepare(&claim).await.unwrap().unwrap();
    let nonce: Vec<u8> = sqlx::query_scalar("SELECT nonce FROM mail_jobs WHERE id = $1")
        .bind(claim.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let ciphertext: Vec<u8> = sqlx::query_scalar("SELECT ciphertext FROM mail_jobs WHERE id = $1")
        .bind(claim.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let token = outgoing.body.split("#token=").nth(1).unwrap();
    let token = token.lines().next().unwrap();
    assert!(!ciphertext.windows(token.len()).any(|window| window == token.as_bytes()));
    sqlx::query("UPDATE email_challenges SET expires_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(queue.prepare(&claim).await.unwrap().is_none());
    queue.finish(&claim, DeliveryOutcome::Discarded).await.unwrap();

    email.request_verification(&alice, "alice@example.test".to_owned()).await.unwrap();
    let replacement = queue.claim().await.unwrap().unwrap();
    sqlx::query("UPDATE mail_jobs SET ciphertext = $1, nonce = $2 WHERE id = $3")
        .bind(ciphertext)
        .bind(nonce)
        .bind(replacement.id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(queue.prepare(&replacement).await.is_err());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn retries_stop_at_five_attempts_and_exhausted_jobs_remain_inspectable(pool: PgPool) {
    let (accounts, queue, email) = support::services(pool.clone());
    let alice = support::account(&accounts, "alice").await;
    email.request_verification(&alice, "alice@example.test".to_owned()).await.unwrap();
    for _ in 0..5 {
        let claim = queue.claim().await.unwrap().unwrap();
        assert!(queue.finish(&claim, DeliveryOutcome::Retry).await.unwrap());
        sqlx::query("UPDATE mail_jobs SET available_at = now()").execute(&pool).await.unwrap();
    }
    assert!(queue.claim().await.unwrap().is_none());
    let status: String =
        sqlx::query_scalar("SELECT status FROM mail_jobs").fetch_one(&pool).await.unwrap();
    assert_eq!(status, "exhausted");
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn queue_capacity_rolls_back_challenge_creation_and_does_not_enumerate_recovery(
    pool: PgPool,
) {
    let (accounts, queue, email) = support::services(pool.clone());
    let alice = support::account(&accounts, "alice").await;
    email.request_verification(&alice, "alice@example.test".to_owned()).await.unwrap();
    email.confirm(support::mailed_token(&queue).await).await.unwrap();
    sqlx::query(
        "INSERT INTO mail_jobs (id, challenge_id, ciphertext, nonce)
         SELECT gen_random_uuid(), email_challenges.id,
                decode('00', 'hex'), decode(repeat('00', 12), 'hex')
         FROM email_challenges CROSS JOIN generate_series(1, 10000)",
    )
    .execute(&pool)
    .await
    .unwrap();
    let verification = email.request_verification(&alice, "other@example.test".to_owned()).await;
    assert!(matches!(verification, Err(AccountError::QuotaExceeded)));
    let known = email.request_recovery("alice@example.test".to_owned()).await;
    let unknown = email.request_recovery("unknown@example.test".to_owned()).await;
    assert!(matches!(known, Err(AccountError::QuotaExceeded)));
    assert!(matches!(unknown, Err(AccountError::QuotaExceeded)));
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM email_challenges").fetch_one(&pool).await.unwrap();
    assert_eq!(count, 1);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and Mailpit"]
async fn smtp_delivery_finishes_the_claimed_job(pool: PgPool) {
    let (accounts, queue, email) = support::services(pool.clone());
    let alice = support::account(&accounts, "alice").await;
    email.request_verification(&alice, "delivery@example.test".to_owned()).await.unwrap();
    let claim = queue.claim().await.unwrap().unwrap();
    queue.deliver(&claim).await.unwrap();
    let status: String = sqlx::query_scalar("SELECT status FROM mail_jobs WHERE id = $1")
        .bind(claim.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "sent");
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn consumed_challenges_are_discarded_and_final_crashed_attempts_are_not_reclaimed(
    pool: PgPool,
) {
    let (accounts, queue, email) = support::services(pool.clone());
    let alice = support::account(&accounts, "alice").await;
    email.request_verification(&alice, "alice@example.test".to_owned()).await.unwrap();
    let claim = queue.claim().await.unwrap().unwrap();
    sqlx::query("UPDATE email_challenges SET consumed_at = now()").execute(&pool).await.unwrap();
    assert!(queue.prepare(&claim).await.unwrap().is_none());
    queue.deliver(&claim).await.unwrap();
    let status: String = sqlx::query_scalar("SELECT status FROM mail_jobs WHERE id = $1")
        .bind(claim.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "discarded");

    email.request_verification(&alice, "alice@example.test".to_owned()).await.unwrap();
    let claim = queue.claim().await.unwrap().unwrap();
    sqlx::query(
        "UPDATE mail_jobs SET attempts = 5, lease_until = now() - interval '1 second'
         WHERE id = $1",
    )
    .bind(claim.id)
    .execute(&pool)
    .await
    .unwrap();
    assert!(queue.claim().await.unwrap().is_none());
    assert!(!queue.finish(&claim, DeliveryOutcome::Sent).await.unwrap());
}

#[test]
fn smtp_settings_reject_missing_keys_and_unencrypted_remote_delivery() {
    use std::collections::HashMap;

    use tg_chat::jobs::MailSettings;

    let mut values = HashMap::new();
    values.insert("TG_CHAT_SMTP_HOST".to_owned(), "smtp.example.test".to_owned());
    values.insert("TG_CHAT_MAIL_FROM".to_owned(), "accounts@example.test".to_owned());
    assert!(MailSettings::from_values(&values).is_err());
    values.insert("TG_CHAT_MAIL_KEY".to_owned(), "private-invalid-key".to_owned());
    let error = MailSettings::from_values(&values).err().unwrap();
    assert!(!error.to_string().contains("private-invalid-key"));
    values.insert("TG_CHAT_MAIL_KEY".to_owned(), STANDARD.encode(VALID_MAIL_KEY));
    values.insert("TG_CHAT_SMTP_MODE".to_owned(), "plain".to_owned());
    assert!(MailSettings::from_values(&values).is_err());
    values.insert("TG_CHAT_SMTP_MODE".to_owned(), "starttls".to_owned());
    assert!(MailSettings::from_values(&values).is_ok());
}
