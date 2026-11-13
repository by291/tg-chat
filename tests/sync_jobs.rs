#[allow(dead_code)]
mod support;

use sqlx::PgPool;
use support::messaging::{fixture, send_input};
use tg_chat::features::realtime::wakeups::{WakeupOutcome, WakeupQueue};

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn publication_acknowledgement_preserves_newer_wakeups_and_fences_expired_workers(
    pool: PgPool,
) {
    let (service, alice, bobby) = fixture(pool.clone()).await;
    service.send(alice.clone(), send_input(bobby.user_id)).await.unwrap();
    let queue = WakeupQueue::new(pool.clone());
    let original = queue.claim().await.unwrap().unwrap();
    service.send(alice, send_input(bobby.user_id)).await.unwrap();
    assert!(queue.finish(&original, WakeupOutcome::Published).await.unwrap());
    let remaining: i64 = sqlx::query_scalar("SELECT position FROM sync_wakeups WHERE user_id = $1")
        .bind(original.user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(remaining > original.position);

    let stale = queue.claim().await.unwrap().unwrap();
    sqlx::query(
        "UPDATE sync_wakeups SET lease_until = now() - interval '1 second' WHERE user_id = $1",
    )
    .bind(stale.user_id)
    .execute(&pool)
    .await
    .unwrap();
    assert!(!queue.finish(&stale, WakeupOutcome::Published).await.unwrap());
    let reclaimed = queue.claim().await.unwrap().unwrap();
    assert_ne!(stale.lease_token, reclaimed.lease_token);
    assert!(!queue.finish(&stale, WakeupOutcome::Published).await.unwrap());
    assert!(queue.finish(&reclaimed, WakeupOutcome::Published).await.unwrap());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn exhausted_wakeups_remain_inspectable_and_can_be_explicitly_retried(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool.clone()).await;
    service.send(alice, send_input(bobby.user_id)).await.unwrap();
    sqlx::query("UPDATE sync_wakeups SET attempts = 4").execute(&pool).await.unwrap();
    let queue = WakeupQueue::new(pool.clone());
    let claim = queue.claim().await.unwrap().unwrap();
    assert!(queue.finish(&claim, WakeupOutcome::Retry).await.unwrap());
    let exhausted = queue.exhausted().await.unwrap();
    assert_eq!(exhausted.len(), 1);
    assert_eq!(exhausted[0].user_id, claim.user_id);
    assert!(queue.retry(claim.user_id).await.unwrap());
    assert!(queue.exhausted().await.unwrap().is_empty());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn retention_requires_reset_and_expiry_cleanup_emits_a_removal(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool.clone()).await;
    let bootstrap = service.bootstrap(bobby.clone()).await.unwrap();
    let sent = service.send(alice, send_input(bobby.user_id)).await.unwrap();
    sqlx::query("UPDATE messages SET expires_at = now() - interval '1 second' WHERE id = $1")
        .bind(sent.message.id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(tg_chat::features::messages::maintenance::expire_one(&pool).await.unwrap());
    let changes = service
        .sync(
            bobby.clone(),
            tg_chat::features::sync::SyncQuery {
                cursor: bootstrap.cursor.clone(),
                limit: None,
            },
        )
        .await
        .unwrap();
    assert!(changes.groups.iter().any(|group| group.removed_message_id == Some(sent.message.id)));

    sqlx::query("UPDATE personal_changes SET created_at = now() - interval '31 days'")
        .execute(&pool)
        .await
        .unwrap();
    tg_chat::features::sync::retention::prune_one(&pool).await.unwrap();
    tg_chat::features::sync::retention::prune_one(&pool).await.unwrap();
    assert!(matches!(
        service
            .sync(
                bobby,
                tg_chat::features::sync::SyncQuery {
                    cursor: bootstrap.cursor,
                    limit: None
                }
            )
            .await,
        Err(tg_chat::features::accounts::AccountError::SyncResetRequired)
    ));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn full_wakeup_capacity_rejects_new_fanout_without_partial_message_acceptance(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool.clone()).await;
    sqlx::query("UPDATE wakeup_queue_budget SET capacity = 1").execute(&pool).await.unwrap();
    assert!(service.send(alice, send_input(bobby.user_id)).await.is_err());
    let counts: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM messages), (SELECT count(*) FROM sync_wakeups)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(counts, (0, 0));
}
