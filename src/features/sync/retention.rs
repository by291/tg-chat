//! Bounded retention for committed personal changes.

use sqlx::PgPool;
use uuid::Uuid;

use crate::features::accounts::AccountError;

const CHANGE_RETENTION_DAYS: i32 = 30;
const RETENTION_BATCH_SIZE: i64 = 1000;

/// Prune one account's old contiguous prefix and advance its floor in the same transaction.
pub async fn prune_one(pool: &PgPool) -> Result<bool, AccountError> {
    let mut transaction = pool.begin().await?;
    let candidate: Option<Uuid> = sqlx::query_scalar(
        "SELECT head.user_id FROM sync_heads head WHERE EXISTS (
            SELECT 1 FROM personal_changes change WHERE change.user_id = head.user_id
              AND change.created_at < now() - $1 * interval '1 day'
              AND change.position = head.retained_floor + 1
         ) ORDER BY head.user_id FOR UPDATE SKIP LOCKED LIMIT 1",
    )
    .bind(CHANGE_RETENTION_DAYS)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(user_id) = candidate else {
        return Ok(false);
    };
    // Transaction start timestamps can differ from commit order; stop before the first recent row.
    let floor = sqlx::query_scalar(
        "SELECT least(head.retained_floor + $3, COALESCE((SELECT min(position) - 1
            FROM personal_changes WHERE user_id = $1
              AND created_at >= now() - $2 * interval '1 day'), head.position))
         FROM sync_heads head WHERE head.user_id = $1",
    )
    .bind(user_id)
    .bind(CHANGE_RETENTION_DAYS)
    .bind(RETENTION_BATCH_SIZE);
    let floor: i64 = floor.fetch_one(&mut *transaction).await?;
    sqlx::query("DELETE FROM personal_changes WHERE user_id = $1 AND position <= $2")
        .bind(user_id)
        .bind(floor)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("UPDATE sync_heads SET retained_floor = $2 WHERE user_id = $1")
        .bind(user_id)
        .bind(floor)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;

    Ok(true)
}
