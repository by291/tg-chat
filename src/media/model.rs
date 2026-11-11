use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::accounts::AccountError;

use super::settings::{DOCUMENT_BYTES, IMAGE_BYTES, PART_BYTES, VOICE_BYTES};

const MAX_FILE_NAME_BYTES: usize = 255;
const SHA256_HEX_LENGTH: usize = 64;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, sqlx::Type, ToSchema)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "media_upload_purpose", rename_all = "snake_case")]
pub enum UploadPurpose {
    Image,
    Video,
    Document,
    Voice,
    Avatar,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, sqlx::Type, ToSchema)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "media_upload_state", rename_all = "snake_case")]
pub enum UploadState {
    Reserved,
    Uploaded,
    Processing,
    Ready,
    Rejected,
    Cancelled,
    Expired,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TransferMode {
    SinglePut,
    Multipart,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReserveUpload {
    pub upload_id: Uuid,
    pub purpose: UploadPurpose,
    pub file_name: String,
    pub size_bytes: i64,
    pub sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, ToSchema)]
pub struct UploadStatus {
    pub upload_id: Uuid,
    pub state: UploadState,
    pub expires_at: DateTime<Utc>,
    pub transfer_mode: TransferMode,
    pub part_size_bytes: Option<i64>,
    pub file_id: Option<Uuid>,
    pub error_code: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, sqlx::Type, ToSchema)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "media_variant_kind", rename_all = "snake_case")]
pub enum MediaVariant {
    Original,
    Thumbnail,
    Poster,
    Playback,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct MediaFileView {
    pub file_id: Uuid,
    pub kind: UploadPurpose,
    pub size_bytes: i64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub duration_ms: Option<i64>,
    pub waveform: Option<Vec<i16>>,
    pub variants: Vec<MediaVariant>,
}

#[derive(sqlx::FromRow)]
pub(super) struct UploadRecord {
    pub id: Uuid,
    pub purpose: UploadPurpose,
    pub file_name: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub state: UploadState,
    pub expires_at: DateTime<Utc>,
    pub file_id: Option<Uuid>,
    pub error_code: Option<String>,
    pub is_expired: bool,
    pub multipart_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TransferRequest {
    #[serde(default)]
    pub part_numbers: Vec<i32>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SignedUpload {
    pub url: String,
    pub part_number: Option<i32>,
    pub headers: std::collections::BTreeMap<String, String>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Default, Serialize, ToSchema)]
pub struct TransferPlan {
    pub confirmed_parts: Vec<i32>,
    pub single_put_complete: bool,
    pub requests: Vec<SignedUpload>,
}

impl MediaVariant {
    /// Use a server-controlled path component for each persisted variant.
    pub(super) fn object_name(self) -> &'static str {
        match self {
            Self::Original => "original",
            Self::Thumbnail => "thumbnail",
            Self::Poster => "poster",
            Self::Playback => "playback",
        }
    }
}

impl ReserveUpload {
    /// Reject malformed metadata before reserving bytes.
    pub(super) fn validate(&self) -> Result<(), AccountError> {
        let size_limit = match self.purpose {
            UploadPurpose::Image | UploadPurpose::Avatar => IMAGE_BYTES,
            UploadPurpose::Document | UploadPurpose::Video => DOCUMENT_BYTES,
            UploadPurpose::Voice => VOICE_BYTES,
        };
        if !(1..=size_limit).contains(&self.size_bytes) {
            return Err(AccountError::Validation("upload size exceeds the supported range"));
        }

        let is_valid_name = !self.file_name.trim().is_empty()
            && self.file_name.len() <= MAX_FILE_NAME_BYTES
            && !self.file_name.contains(['/', '\\'])
            && !self.file_name.chars().any(char::is_control);
        if !is_valid_name {
            return Err(AccountError::Validation("invalid upload file name"));
        }

        let is_valid_digest = self.sha256.len() == SHA256_HEX_LENGTH
            && self
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase());
        if !is_valid_digest {
            return Err(AccountError::Validation("invalid upload SHA-256 digest"));
        }

        Ok(())
    }
}

impl UploadRecord {
    /// Compare a replay with the original reservation payload.
    pub(super) fn matches(&self, request: &ReserveUpload) -> bool {
        self.purpose == request.purpose
            && self.file_name == request.file_name
            && self.size_bytes == request.size_bytes
            && self.sha256 == request.sha256
    }

    /// Project upload progress without disclosing storage identities.
    pub(super) fn status(self) -> UploadStatus {
        let (transfer_mode, part_size_bytes) = if self.size_bytes > PART_BYTES {
            (TransferMode::Multipart, Some(PART_BYTES))
        } else {
            (TransferMode::SinglePut, None)
        };
        let can_expire = matches!(self.state, UploadState::Reserved | UploadState::Ready);
        let state = if can_expire && self.is_expired {
            UploadState::Expired
        } else {
            self.state
        };

        UploadStatus {
            upload_id: self.id,
            state,
            expires_at: self.expires_at,
            transfer_mode,
            part_size_bytes,
            file_id: if state == UploadState::Expired {
                None
            } else {
                self.file_id
            },
            error_code: self.error_code,
        }
    }
}
