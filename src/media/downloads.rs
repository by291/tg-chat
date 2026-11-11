use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection, QueryBuilder};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    accounts::{AccountError, Actor},
    messages::{MessageService, projection::restrict_visible},
};

use super::{MediaVariant, UploadService, jobs::variant_key, storage::DownloadSignature};

const DOWNLOAD_PREFIX: &str =
    "SELECT file.id AS file_id, upload.file_name, variant.mime_type FROM media_files file
     JOIN media_uploads upload ON upload.id = file.upload_id
     JOIN media_variants variant ON variant.file_id = file.id ";

#[derive(Clone, Copy)]
pub struct MessageDownload {
    pub message_id: Uuid,
    pub occurrence_id: Uuid,
    pub variant: MediaVariant,
}

#[derive(Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AvatarOwner {
    User,
    Conversation,
}

#[derive(Clone, Copy)]
pub struct AvatarDownload {
    pub owner: AvatarOwner,
    pub owner_id: Uuid,
    pub variant: MediaVariant,
}

#[derive(Clone, Copy)]
pub enum DownloadReference {
    Message(MessageDownload),
    Avatar(AvatarDownload),
    Upload {
        upload_id: Uuid,
        variant: MediaVariant,
    },
}

#[derive(Serialize, ToSchema)]
pub struct SignedDownload {
    pub url: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct DownloadObject {
    file_id: Uuid,
    file_name: String,
    mime_type: String,
}

fn disposition(file_name: &str, variant: MediaVariant) -> String {
    if variant != MediaVariant::Original {
        return "inline".to_owned();
    }

    let encoded: String = url::form_urlencoded::byte_serialize(file_name.as_bytes()).collect();
    let encoded = encoded.replace('+', "%20");
    format!("attachment; filename=\"download\"; filename*=UTF-8''{encoded}")
}

async fn message_object(
    connection: &mut PgConnection,
    actor: &Actor,
    input: MessageDownload,
) -> Result<Option<DownloadObject>, sqlx::Error> {
    let mut statement = QueryBuilder::new(DOWNLOAD_PREFIX);
    statement.push(
        "JOIN media_message_references reference ON reference.file_id = file.id
         JOIN messages message ON message.id = reference.message_id
         WHERE file.deleting_at IS NULL AND file.deleted_at IS NULL AND message.id = ",
    );
    statement.push_bind(input.message_id);
    statement.push(" AND reference.occurrence_id = ").push_bind(input.occurrence_id);
    statement.push(" AND variant.kind = ").push_bind(input.variant);
    restrict_visible(&mut statement, actor.user_id);
    statement.build_query_as().fetch_optional(connection).await
}

async fn avatar_object(
    connection: &mut PgConnection,
    actor: &Actor,
    input: AvatarDownload,
) -> Result<Option<DownloadObject>, sqlx::Error> {
    if input.variant != MediaVariant::Thumbnail {
        return Ok(None);
    }
    let mut statement = QueryBuilder::new(DOWNLOAD_PREFIX);
    match input.owner {
        AvatarOwner::User => {
            // Active users expose this profile metadata through the authenticated directory.
            statement.push(
                "JOIN users profile ON profile.avatar_file_id = file.id
                 WHERE NOT profile.is_suspended AND profile.id = ",
            );
            statement.push_bind(input.owner_id);
        }
        AvatarOwner::Conversation => {
            statement.push(
                "JOIN conversations conversation ON conversation.avatar_file_id = file.id
                 WHERE conversation.deleted_at IS NULL AND NOT conversation.is_quarantined
                   AND conversation.id = ",
            );
            statement.push_bind(input.owner_id);
            statement.push(
                " AND (EXISTS (SELECT 1 FROM conversation_members member
                   WHERE member.conversation_id = conversation.id AND member.directory_active
                     AND NOT member.is_banned AND member.user_id = ",
            );
            statement.push_bind(actor.user_id);
            statement.push(
                ") OR (conversation.is_public AND conversation.kind IN ('group', 'channel')
                  AND NOT EXISTS (SELECT 1 FROM conversation_members banned
                    WHERE banned.conversation_id = conversation.id AND banned.is_banned
                      AND banned.user_id = ",
            );
            statement.push_bind(actor.user_id);
            statement.push(")))");
        }
    }
    statement.push(
        " AND file.deleting_at IS NULL AND file.deleted_at IS NULL AND variant.kind = 'thumbnail'",
    );

    statement.build_query_as().fetch_optional(connection).await
}

async fn upload_object(
    connection: &mut PgConnection,
    actor: &Actor,
    upload_id: Uuid,
    variant: MediaVariant,
) -> Result<Option<DownloadObject>, sqlx::Error> {
    let mut statement = QueryBuilder::new(DOWNLOAD_PREFIX);
    statement.push(" WHERE file.deleting_at IS NULL AND file.deleted_at IS NULL AND upload.id = ");
    statement.push_bind(upload_id);
    statement.push(" AND upload.owner_id = ").push_bind(actor.user_id);
    statement.push(" AND upload.session_id = ").push_bind(actor.session_id);
    // Once published, this file can be read only through its current live reference.
    statement.push(" AND upload.state = 'ready' AND file.ready_until > now()");
    statement.push(" AND variant.kind = ").push_bind(variant);
    statement.push(" AND (upload.purpose <> 'avatar' OR variant.kind = 'thumbnail')");

    statement.build_query_as().fetch_optional(connection).await
}

impl UploadService {
    /// Mint a private, short-lived GET URL after checking the specific reference.
    pub async fn sign_download(
        &self,
        actor: &Actor,
        reference: DownloadReference,
    ) -> Result<SignedDownload, AccountError> {
        let messages = MessageService::new(self.reservations.accounts.clone());
        let mut transaction = messages.snapshot(actor).await?;
        let (object, variant) = match reference {
            DownloadReference::Message(input) => {
                let object = message_object(&mut transaction, actor, input).await?;
                (object, input.variant)
            }
            DownloadReference::Avatar(input) => {
                let object = avatar_object(&mut transaction, actor, input).await?;
                (object, input.variant)
            }
            DownloadReference::Upload {
                upload_id,
                variant,
            } => {
                let object = upload_object(&mut transaction, actor, upload_id, variant).await?;
                (object, variant)
            }
        };
        let object = object.ok_or(AccountError::NotFound)?;
        transaction.commit().await?;

        let key = variant_key(object.file_id, variant);
        let signature = DownloadSignature {
            key: &key,
            mime_type: &object.mime_type,
            disposition: disposition(&object.file_name, variant),
        };
        self.storage.sign_download(signature).await
    }
}
