use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

use super::content::MessageContent;
use crate::{
    conversations::ConversationView,
    media::{AttachmentInput, AttachmentView},
};

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Destination {
    Recipient {
        user_id: Uuid,
    },
    Conversation {
        conversation_id: Uuid,
    },
    Saved,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SendMessage {
    pub operation_id: Uuid,
    pub message_id: Uuid,
    pub destination: Destination,
    pub content: MessageContent,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<AttachmentInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply: Option<ReplyInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft_version: Option<String>,
}

#[derive(Clone, FromRow, Serialize, ToSchema)]
pub struct CanonicalMessage {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub author_id: Uuid,
    pub author_name: String,
    pub sequence: String,
    pub version: String,
    pub created_at: DateTime<Utc>,
    pub edited_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub is_deleted: bool,
    pub interaction_version: String,
    pub is_pinned: bool,
    pub service_kind: Option<String>,
    #[serde(skip)]
    pub(crate) reply_id: Option<Uuid>,
    #[serde(skip)]
    pub(crate) reply_quote: Option<String>,
    #[sqlx(skip)]
    pub reply: Option<ReplyView>,
    #[sqlx(skip)]
    pub reactions: Vec<ReactionView>,
    #[serde(skip)]
    pub(crate) has_attachments: bool,
    #[sqlx(skip)]
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<AttachmentView>,
    #[sqlx(json)]
    pub content: MessageContent,
}

#[derive(Serialize, ToSchema)]
pub struct SendReceipt {
    pub observation_cursor: String,
    pub message: CanonicalMessage,
    pub conversation: ConversationView,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReplyInput {
    pub message_id: Uuid,
    pub quote: Option<String>,
}

#[derive(Clone, Serialize, ToSchema)]
pub struct ReplyView {
    pub message_id: Uuid,
    pub is_unavailable: bool,
    pub expires_at: Option<DateTime<Utc>>,
    pub quote: Option<String>,
}

#[derive(Clone, FromRow, Serialize, ToSchema)]
pub struct ReactionView {
    pub emoji: String,
    pub count: String,
    pub is_selected: bool,
}
