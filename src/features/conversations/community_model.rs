use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CommunitySettings {
    pub title: String,
    pub description: String,
    pub public_handle: Option<String>,
    pub is_public: bool,
    pub requires_approval: bool,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateCommunity {
    pub operation_id: Uuid,
    pub conversation_id: Uuid,
    pub kind: String,
    #[serde(flatten)]
    pub settings: CommunitySettings,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CommunityCommand {
    pub operation_id: Uuid,
    pub conversation_id: Uuid,
    pub action: CommunityAction,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CommunityAction {
    Join {
        token: Option<String>,
        invitation_id: Option<Uuid>,
    },
    Invite {
        invitation_id: Uuid,
        token: Option<String>,
        target_id: Option<Uuid>,
        expires_at: DateTime<Utc>,
        max_uses: Option<i64>,
    },
    RevokeInvite {
        invitation_id: Uuid,
    },
    Approve {
        user_id: Uuid,
    },
    Reject {
        user_id: Uuid,
    },
    Leave,
    Settings {
        expected_version: String,
        settings: CommunitySettings,
    },
    Avatar {
        expected_version: String,
        file_id: Option<Uuid>,
    },
    Role {
        user_id: Uuid,
        role: String,
    },
    Transfer {
        user_id: Uuid,
    },
    Remove {
        user_id: Uuid,
    },
    Ban {
        user_id: Uuid,
    },
    Unban {
        user_id: Uuid,
    },
    Mute {
        user_id: Uuid,
        until: Option<DateTime<Utc>>,
    },
    Delete,
}

impl CommunityAction {
    /// Include a targeted account in the transaction's ordered capacity and policy locks.
    pub(crate) fn target_user(&self) -> Option<Uuid> {
        match self {
            Self::Invite {
                target_id,
                ..
            } => *target_id,
            Self::Approve {
                user_id,
            }
            | Self::Reject {
                user_id,
            } => Some(*user_id),
            Self::Role {
                user_id,
                ..
            }
            | Self::Transfer {
                user_id,
            }
            | Self::Remove {
                user_id,
            }
            | Self::Ban {
                user_id,
            }
            | Self::Unban {
                user_id,
            }
            | Self::Mute {
                user_id,
                ..
            } => Some(*user_id),
            _ => None,
        }
    }
}

#[derive(FromRow)]
pub(crate) struct CommunityRecord {
    pub id: Uuid,
    pub kind: String,
    pub owner_id: Uuid,
    pub is_public: bool,
    pub requires_approval: bool,
    pub deleted_at: Option<DateTime<Utc>>,
}

pub(crate) struct CommunityContext<'a> {
    pub actor: &'a crate::features::accounts::Actor,
    pub command: &'a CommunityCommand,
    pub community: &'a CommunityRecord,
}
