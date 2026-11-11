use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::accounts::AccountError;

use super::{MediaFileView, MediaVariant, UploadPurpose};

const MAX_ALBUM_ITEMS: usize = 10;

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AttachmentInput {
    pub occurrence_id: Uuid,
    pub file_id: Uuid,
}

#[derive(Clone, Serialize, ToSchema)]
pub struct AttachmentView {
    pub occurrence_id: Uuid,
    pub file_name: String,
    pub file: MediaFileView,
}

#[derive(FromRow)]
struct ReadyFile {
    id: Uuid,
    purpose: UploadPurpose,
}

#[derive(FromRow)]
struct AttachmentRow {
    occurrence_id: Uuid,
    file_name: String,
    file_id: Uuid,
    purpose: UploadPurpose,
    size_bytes: i64,
    width: Option<i32>,
    height: Option<i32>,
    duration_ms: Option<i64>,
    waveform: Option<Vec<i16>>,
    variants: Vec<MediaVariant>,
}

pub(crate) struct MessageReferences<'a> {
    pub owner_id: Uuid,
    pub message_id: Uuid,
    pub attachments: &'a [AttachmentInput],
}

/// Validate the bounded album envelope before hashing a send request.
pub(crate) fn validate_attachments(attachments: &[AttachmentInput]) -> Result<(), AccountError> {
    if attachments.len() > MAX_ALBUM_ITEMS {
        return Err(AccountError::Validation("an album supports at most ten attachments"));
    }

    let mut occurrences = HashSet::with_capacity(attachments.len());
    for attachment in attachments {
        if !occurrences.insert(attachment.occurrence_id) {
            return Err(AccountError::Validation("duplicate attachment occurrence"));
        }
    }

    Ok(())
}

async fn lock_message_files(
    connection: &mut PgConnection,
    reference: &MessageReferences<'_>,
) -> Result<Vec<Uuid>, AccountError> {
    let mut requested: Vec<Uuid> = reference.attachments.iter().map(|item| item.file_id).collect();
    requested.sort_unstable();
    requested.dedup();

    // Lock in file order so multi-file sends and garbage collection share one fence.
    let files = sqlx::query_as::<_, ReadyFile>(
        "SELECT file.id, upload.purpose FROM media_files file
         JOIN media_uploads upload ON upload.id = file.upload_id
         WHERE file.id = ANY($1) AND upload.owner_id = $2
           AND file.deleting_at IS NULL AND file.deleted_at IS NULL
           AND (file.ready_until > now() OR EXISTS (
               SELECT 1 FROM media_live_file_references reference WHERE reference.file_id = file.id
           ))
         ORDER BY file.id FOR UPDATE OF file",
    )
    .bind(&requested)
    .bind(reference.owner_id);
    let files = files.fetch_all(connection).await?;
    if files.len() != requested.len() {
        return Err(AccountError::MediaFileUnavailable);
    }

    let is_album = reference.attachments.len() > 1;
    let is_valid = files.iter().all(|file| {
        let is_visual = matches!(file.purpose, UploadPurpose::Image | UploadPurpose::Video);
        file.purpose != UploadPurpose::Avatar && (!is_album || is_visual)
    });
    if !is_valid {
        return Err(AccountError::Validation("unsupported media combination"));
    }

    Ok(files.into_iter().map(|file| file.id).collect())
}

/// Attach all ordered occurrences and consume the ready holds in the send transaction.
pub(crate) async fn attach_message(
    connection: &mut PgConnection,
    reference: MessageReferences<'_>,
) -> Result<(), AccountError> {
    if reference.attachments.is_empty() {
        return Ok(());
    }

    let ready_ids = lock_message_files(connection, &reference).await?;
    let occurrence_ids: Vec<Uuid> =
        reference.attachments.iter().map(|item| item.occurrence_id).collect();
    let file_ids: Vec<Uuid> = reference.attachments.iter().map(|item| item.file_id).collect();
    let insert = sqlx::query(
        "INSERT INTO media_message_references (message_id, occurrence_id, file_id, position)
         SELECT $1, item.occurrence_id, item.file_id, item.position
         FROM unnest($2::uuid[], $3::uuid[]) WITH ORDINALITY
              AS item(occurrence_id, file_id, position)",
    )
    .bind(reference.message_id)
    .bind(occurrence_ids)
    .bind(file_ids);
    insert.execute(&mut *connection).await?;
    consume_holds(connection, &ready_ids).await?;

    Ok(())
}

/// End the pending hold once a durable reference keeps the file alive.
pub(crate) async fn consume_holds(
    connection: &mut PgConnection,
    file_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    let query = sqlx::query(
        "UPDATE media_files SET ready_until = least(ready_until, now()) WHERE id = ANY($1)",
    );
    query.bind(file_ids).execute(connection).await?;

    Ok(())
}

/// Drop shared references under the same file locks used by collection.
pub(crate) async fn detach_message(
    connection: &mut PgConnection,
    message_id: Uuid,
) -> Result<(), sqlx::Error> {
    let lock = sqlx::query(
        "SELECT id FROM media_files WHERE id IN (
             SELECT file_id FROM media_message_references WHERE message_id = $1
         ) ORDER BY id FOR UPDATE",
    )
    .bind(message_id);
    lock.fetch_all(&mut *connection).await?;

    let delete = sqlx::query("DELETE FROM media_message_references WHERE message_id = $1");
    delete.bind(message_id).execute(connection).await?;

    Ok(())
}

/// Project immutable media metadata for an already-authorized message.
pub(crate) async fn attachment_views(
    connection: &mut PgConnection,
    message_id: Uuid,
) -> Result<Vec<AttachmentView>, sqlx::Error> {
    let query = sqlx::query_as::<_, AttachmentRow>(
        "SELECT reference.occurrence_id, upload.file_name, file.id AS file_id, upload.purpose,
                file.size_bytes, file.width, file.height, file.duration_ms, file.waveform,
                ARRAY(SELECT variant.kind FROM media_variants variant
                      WHERE variant.file_id = file.id ORDER BY variant.kind) AS variants
         FROM media_message_references reference
         JOIN media_files file ON file.id = reference.file_id
         JOIN media_uploads upload ON upload.id = file.upload_id
         WHERE reference.message_id = $1 AND file.deleted_at IS NULL
         ORDER BY reference.position",
    )
    .bind(message_id);
    let rows = query.fetch_all(connection).await?;
    let mut attachments = Vec::with_capacity(rows.len());
    for row in rows {
        attachments.push(AttachmentView {
            occurrence_id: row.occurrence_id,
            file_name: row.file_name,
            file: MediaFileView {
                file_id: row.file_id,
                kind: row.purpose,
                size_bytes: row.size_bytes,
                width: row.width,
                height: row.height,
                duration_ms: row.duration_ms,
                waveform: row.waveform,
                variants: row.variants,
            },
        });
    }

    Ok(attachments)
}
