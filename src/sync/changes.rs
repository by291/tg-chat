use sqlx::PgConnection;
use uuid::Uuid;

pub(crate) struct ChangeGroup<'a> {
    pub participants: &'a [Uuid],
    pub conversation_id: Uuid,
    pub message_id: Option<Uuid>,
}

/// Allocate positions under ordered head locks so later commits cannot skip an earlier group.
pub(crate) async fn append(
    connection: &mut PgConnection,
    group: ChangeGroup<'_>,
) -> Result<(), sqlx::Error> {
    for user_id in group.participants {
        let position: i64 = sqlx::query_scalar(
            "UPDATE sync_heads SET position = position + 1 WHERE user_id = $1 RETURNING position",
        )
        .bind(user_id)
        .fetch_one(&mut *connection)
        .await?;
        let insert = sqlx::query(
            "INSERT INTO personal_changes (user_id, position, conversation_id, message_id)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(user_id)
        .bind(position);
        insert.bind(group.conversation_id).bind(group.message_id).execute(&mut *connection).await?;

        // Coalesce committed hints without changing an in-flight Worker lease.
        sqlx::query(
            "INSERT INTO sync_wakeups (user_id, position) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET
                 position = greatest(sync_wakeups.position, EXCLUDED.position), updated_at = now()",
        )
        .bind(user_id)
        .bind(position)
        .execute(&mut *connection)
        .await?;
    }

    Ok(())
}
