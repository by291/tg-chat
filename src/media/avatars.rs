use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::accounts::AccountError;

use super::references::consume_holds;

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SetAvatar {
    pub operation_id: Uuid,
    pub expected_version: String,
    pub file_id: Option<Uuid>,
}

pub(crate) struct AvatarChange {
    pub actor_id: Uuid,
    pub previous: Option<Uuid>,
    pub next: Option<Uuid>,
}

#[derive(FromRow)]
struct AvatarFile {
    id: Uuid,
    is_attachable: bool,
}

/// Serialize an avatar replacement with collection and validate the new upload.
pub(crate) async fn prepare_avatar(
    connection: &mut PgConnection,
    change: AvatarChange,
) -> Result<(), AccountError> {
    if change.previous == change.next {
        return Ok(());
    }

    // The profile or conversation owner row is already locked before the ordered file locks.
    let file_ids: Vec<Uuid> = [change.previous, change.next].into_iter().flatten().collect();
    let lock = sqlx::query_as::<_, AvatarFile>(
        "SELECT file.id, (upload.owner_id = $2 AND upload.purpose = 'avatar'
                 AND file.ready_until > now()
                 AND file.deleting_at IS NULL AND file.deleted_at IS NULL
                 AND EXISTS (SELECT 1 FROM media_variants variant
                     WHERE variant.file_id = file.id AND variant.kind = 'thumbnail')
             ) AS is_attachable
         FROM media_files file JOIN media_uploads upload ON upload.id = file.upload_id
         WHERE file.id = ANY($1) ORDER BY file.id FOR UPDATE OF file",
    )
    .bind(file_ids)
    .bind(change.actor_id);
    let locked = lock.fetch_all(&mut *connection).await?;

    let Some(next) = change.next else {
        return Ok(());
    };
    let is_valid = locked.iter().any(|file| file.id == next && file.is_attachable);
    if !is_valid {
        return Err(AccountError::NotFound);
    }
    consume_holds(connection, &[next]).await?;

    Ok(())
}
