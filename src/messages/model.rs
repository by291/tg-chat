use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

use super::content::MessageContent;
use crate::conversations::ConversationView;

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
    #[sqlx(json)]
    pub content: MessageContent,
}

#[derive(Serialize, ToSchema)]
pub struct SendReceipt {
    pub message: CanonicalMessage,
    pub conversation: ConversationView,
}
