#[allow(dead_code)]
mod support;

use std::time::Duration;

use sqlx::PgPool;
use tg_chat::runtime::worker::{self, WorkerServices};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const OBSERVATION_TIMEOUT: Duration = Duration::from_secs(3);
const RETRY_INTERVAL: Duration = Duration::from_millis(20);
const IDLE_SESSION_DAYS: i64 = 30;

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn failed_expiry_does_not_block_command_receipt_retention(pool: PgPool) {
    let (messages, sender, recipient) = support::messaging::fixture(pool.clone()).await;
    let sent = messages
        .send(sender.clone(), support::messaging::send_input(recipient.user_id))
        .await
        .unwrap();

    let expire = sqlx::query("UPDATE messages SET expires_at = now() WHERE id = $1");
    expire.bind(sent.message.id).execute(&pool).await.unwrap();

    // Inject a database write failure for message expiry without affecting receipt retention.
    sqlx::query("ALTER TABLE messages ADD CHECK (deleted_at IS NULL)")
        .execute(&pool)
        .await
        .unwrap();

    let operation_id = Uuid::new_v4();
    let receipt = sqlx::query(
        "INSERT INTO command_receipts
             (actor_id, operation_id, payload_hash, conversation_id, created_at)
         VALUES ($1, $2, decode('00', 'hex'), $3, now() - interval '8 days')",
    );
    let receipt = receipt.bind(sender.user_id).bind(operation_id).bind(sent.conversation.id);
    receipt.execute(&pool).await.unwrap();

    let stop = CancellationToken::new();
    let task = tokio::spawn(worker::run(
        WorkerServices {
            pool: pool.clone(),
            client: None,
            idle_days: IDLE_SESSION_DAYS,
        },
        stop.clone(),
    ));
    let result = tokio::time::timeout(OBSERVATION_TIMEOUT, async {
        loop {
            let retained = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (SELECT 1 FROM command_receipts WHERE operation_id = $1)",
            );
            let is_retained = retained.bind(operation_id).fetch_one(&pool).await.unwrap();
            if !is_retained {
                break;
            }

            tokio::time::sleep(RETRY_INTERVAL).await;
        }
    })
    .await;

    stop.cancel();
    task.await.unwrap();
    result.expect("receipt retention must proceed when message expiry fails");
}
