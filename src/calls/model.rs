use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::accounts::Actor;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum CallMode {
    Voice,
    Video,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum CallPhase {
    Ringing,
    Connecting,
    Active,
    Ended,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum CallEndReason {
    Declined,
    Cancelled,
    Missed,
    Completed,
    PermissionDenied,
    TransportFailed,
    AccessRevoked,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CallAction {
    Accept,
    Decline,
    Cancel,
    Hangup,
    MediaPermissionDenied,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CallDirection {
    Incoming,
    Outgoing,
}

#[derive(Clone, Copy, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct StartCall {
    pub operation_id: Uuid,
    pub conversation_id: Uuid,
    pub mode: CallMode,
}

#[derive(Clone, Copy)]
pub struct CallCommand {
    pub call_id: Uuid,
    pub operation_id: Uuid,
    pub action: CallAction,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CallView {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub peer_id: Uuid,
    pub peer_display_name: String,
    pub direction: CallDirection,
    pub mode: CallMode,
    pub phase: CallPhase,
    pub revision: String,
    pub deadline: Option<DateTime<Utc>>,
    pub is_room_ready: bool,
    pub end_reason: Option<CallEndReason>,
    pub allowed_actions: Vec<CallAction>,
}

#[derive(FromRow)]
pub(crate) struct CallRow {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub caller_id: Uuid,
    pub recipient_id: Uuid,
    pub caller_session_id: Uuid,
    pub accepting_session_id: Option<Uuid>,
    pub mode: CallMode,
    pub phase: CallPhase,
    pub revision: i64,
    pub ringing_deadline: DateTime<Utc>,
    pub setup_deadline: Option<DateTime<Utc>>,
    pub end_reason: Option<CallEndReason>,
}

impl CallRow {
    /// Determine whether the account belongs to the immutable participant pair.
    pub(crate) fn has_participant(&self, actor: &Actor) -> bool {
        actor.user_id == self.caller_id || actor.user_id == self.recipient_id
    }

    /// Determine whether this session owns one side of the accepted call.
    pub(crate) fn is_designated(&self, actor: &Actor) -> bool {
        let is_caller =
            actor.user_id == self.caller_id && actor.session_id == self.caller_session_id;
        let is_recipient = actor.user_id == self.recipient_id
            && Some(actor.session_id) == self.accepting_session_id;

        is_caller || is_recipient
    }

    /// Derive the actions this session can apply at the current database time.
    pub(crate) fn allowed_actions(&self, actor: &Actor, now: DateTime<Utc>) -> Vec<CallAction> {
        if self.deadline().is_some_and(|deadline| deadline <= now) {
            return Vec::new();
        }

        match self.phase {
            CallPhase::Ringing if actor.user_id == self.recipient_id => {
                vec![CallAction::Accept, CallAction::Decline]
            }
            CallPhase::Ringing if self.is_designated(actor) => vec![CallAction::Cancel],
            CallPhase::Connecting if self.is_designated(actor) => {
                vec![CallAction::Hangup, CallAction::MediaPermissionDenied]
            }
            CallPhase::Active if self.is_designated(actor) => vec![CallAction::Hangup],
            _ => Vec::new(),
        }
    }

    /// Return the deadline for the current phase.
    pub(crate) fn deadline(&self) -> Option<DateTime<Utc>> {
        match self.phase {
            CallPhase::Ringing => Some(self.ringing_deadline),
            CallPhase::Connecting => self.setup_deadline,
            _ => None,
        }
    }

    /// Identify the other participant relative to the requesting account.
    pub(crate) fn peer_id(&self, actor: &Actor) -> Uuid {
        if actor.user_id == self.caller_id {
            return self.recipient_id;
        }

        self.caller_id
    }

    /// Render session-relative state without exposing internal participant identities.
    pub(crate) fn view(&self, viewer: CallViewer<'_>) -> CallView {
        let direction = if viewer.actor.user_id == self.caller_id {
            CallDirection::Outgoing
        } else {
            CallDirection::Incoming
        };

        CallView {
            id: self.id,
            conversation_id: self.conversation_id,
            peer_id: self.peer_id(viewer.actor),
            peer_display_name: viewer.peer_display_name,
            direction,
            mode: self.mode,
            phase: self.phase,
            revision: self.revision.to_string(),
            deadline: self.deadline(),
            is_room_ready: viewer.is_room_ready,
            end_reason: self.end_reason,
            allowed_actions: self.allowed_actions(viewer.actor, viewer.now),
        }
    }
}

pub(crate) struct CallViewer<'a> {
    pub actor: &'a Actor,
    pub peer_display_name: String,
    pub now: DateTime<Utc>,
    pub is_room_ready: bool,
}
