use sqlx::PgConnection;
use uuid::Uuid;

pub(crate) struct ChangeGroup<'a> {
    pub participants: &'a [Uuid],
    pub conversation_id: Uuid,
    pub message_id: Option<Uuid>,
}

enum ChangeKind {
    Update,
    NewMessage,
}

/// Allocate positions under ordered head locks so later commits cannot skip an earlier group.
pub(crate) async fn append(
    connection: &mut PgConnection,
    group: ChangeGroup<'_>,
) -> Result<(), sqlx::Error> {
    append_change(connection, group, ChangeKind::Update).await
}

/// Mark accepted messages for alert delivery without replaying later content updates.
pub(crate) async fn append_new_message(
    connection: &mut PgConnection,
    group: ChangeGroup<'_>,
) -> Result<(), sqlx::Error> {
    append_change(connection, group, ChangeKind::NewMessage).await
}

async fn append_change(
    connection: &mut PgConnection,
    group: ChangeGroup<'_>,
    kind: ChangeKind,
) -> Result<(), sqlx::Error> {
    let is_new_message = matches!(kind, ChangeKind::NewMessage);
    for user_id in group.participants {
        let position: i64 = sqlx::query_scalar(
            "UPDATE sync_heads SET position = position + 1 WHERE user_id = $1 RETURNING position",
        )
        .bind(user_id)
        .fetch_one(&mut *connection)
        .await?;
        let insert = sqlx::query(
            "INSERT INTO personal_changes (
                 user_id, position, conversation_id, message_id, is_new_message
             ) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(user_id)
        .bind(position);
        let insert = insert.bind(group.conversation_id).bind(group.message_id).bind(is_new_message);
        insert.execute(&mut *connection).await?;

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
