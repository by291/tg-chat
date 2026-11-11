use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgConnection;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{
    CanonicalMessage, Destination, MessageService, acceptance,
    content::{MessageContent, validate_content},
    history::parse_sequence,
    projection,
    service::AcceptanceError,
};
use crate::{
    accounts::{AccountError, Actor, sessions::lock_actor},
    conversations::{self, ConversationView, access},
    sync::changes::{self, ChangeGroup},
};

const TRANSACTION_ATTEMPTS: usize = 3;
const MAX_REACTIONS_PER_ACCOUNT: i64 = 3;
#[rustfmt::skip]
const ALLOWED_REACTIONS: &[&str] = &[
    "👍",
    "👎",
    "❤️",
    "🔥",
    "🥰",
    "👏",
    "😁",
    "🤔",
    "😢",
    "🎉",
];

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MessageCommand {
    pub operation_id: Uuid,
    pub conversation_id: Uuid,
    pub action: CommandAction,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CommandAction {
    Draft {
        expected_version: String,
        content: Option<MessageContent>,
        reply: Option<super::ReplyInput>,
    },
    Read {
        through: String,
    },
    Preferences {
        change: PreferenceChange,
    },
    Clear,
    Close,
    Expiry {
        days: i32,
    },
    Edit {
        message_id: Uuid,
        expected_version: String,
        content: MessageContent,
    },
    Delete {
        message_id: Uuid,
    },
    HideMessage {
        message_id: Uuid,
    },
    Reaction {
        message_id: Uuid,
        emoji: String,
        is_selected: bool,
    },
    Pin {
        message_id: Uuid,
        is_pinned: bool,
    },
    VotePoll {
        message_id: Uuid,
        option_ids: Vec<Uuid>,
    },
    EditPoll {
        message_id: Uuid,
        expected_poll_version: String,
        poll: super::polls::PollInput,
    },
    AddPollOption {
        message_id: Uuid,
        expected_poll_version: String,
        option: super::polls::PollOptionInput,
    },
    ClosePoll {
        message_id: Uuid,
    },
    SetForwardingPolicy {
        is_enabled: bool,
    },
    BatchHide {
        message_ids: Vec<Uuid>,
    },
    BatchDelete {
        message_ids: Vec<Uuid>,
    },
    SetChecklistTask {
        message_id: Uuid,
        task_id: Uuid,
        expected_task_version: String,
        is_complete: bool,
    },
    AppendChecklistTasks {
        message_id: Uuid,
        expected_list_version: String,
        tasks: Vec<super::checklists::ChecklistTaskInput>,
    },
    EditChecklist {
        message_id: Uuid,
        expected_list_version: String,
        checklist: super::checklists::ChecklistInput,
    },
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(tag = "field", rename_all = "snake_case", deny_unknown_fields)]
pub enum PreferenceChange {
    Archive {
        is_archived: bool,
    },
    Hidden {
        is_hidden: bool,
    },
    Unread {
        is_manually_unread: bool,
    },
    Pin {
        rank: Option<i32>,
    },
    Mute {
        until: Option<DateTime<Utc>>,
    },
    ArchiveRetention {
        keep_archived: bool,
    },
}

#[derive(Serialize, ToSchema)]
pub struct CommandReceipt {
    pub observation_cursor: String,
    pub conversation: Option<ConversationView>,
    pub message: Option<CanonicalMessage>,
}

impl CommandAction {
    /// Identify the target when an action changes an existing message.
    pub(crate) fn message_id(&self) -> Option<Uuid> {
        match self {
            Self::Edit {
                message_id,
                ..
            }
            | Self::Delete {
                message_id,
            }
            | Self::HideMessage {
                message_id,
            }
            | Self::Reaction {
                message_id,
                ..
            }
            | Self::Pin {
                message_id,
                ..
            }
            | Self::VotePoll {
                message_id,
                ..
            }
            | Self::EditPoll {
                message_id,
                ..
            }
            | Self::AddPollOption {
                message_id,
                ..
            }
            | Self::ClosePoll {
                message_id,
            }
            | Self::SetChecklistTask {
                message_id,
                ..
            }
            | Self::AppendChecklistTasks {
                message_id,
                ..
            }
            | Self::EditChecklist {
                message_id,
                ..
            } => Some(*message_id),
            _ => None,
        }
    }
}

pub(crate) struct CommandContext<'a> {
    pub actor: &'a Actor,
    pub input: &'a MessageCommand,
    pub conversation: &'a access::LockedConversation,
}

/// Recalculate personal unread state from the same visibility rules used by history.
pub(crate) async fn repair_unread(
    connection: &mut PgConnection,
    conversation_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE conversation_members member SET unread_count = (
            SELECT count(*) FROM messages message
            WHERE message.conversation_id = member.conversation_id
              AND message.author_id <> member.user_id AND message.service_kind IS NULL
              AND message.sequence > greatest(member.read_through, member.clear_through)
              AND message.deleted_at IS NULL
              AND (message.expires_at IS NULL OR message.expires_at > now())
              AND NOT EXISTS (SELECT 1 FROM hidden_messages hidden
                  WHERE hidden.user_id = member.user_id AND hidden.message_id = message.id)
         ) WHERE member.conversation_id = $1",
    )
    .bind(conversation_id)
    .execute(connection)
    .await?;

    Ok(())
}

async fn command_message(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
) -> Result<CanonicalMessage, AcceptanceError> {
    let mut statement = sqlx::QueryBuilder::new(acceptance::MESSAGE_SELECT);
    statement.push(" WHERE message.id = ").push_bind(context.input.action.message_id());
    statement.push(" AND message.conversation_id = ").push_bind(context.input.conversation_id);
    projection::restrict_visible(&mut statement, context.actor.user_id);
    let message = statement.build_query_as().fetch_optional(connection).await?;

    message.ok_or(AccountError::NotFound.into())
}

async fn edit(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
    message: &CanonicalMessage,
) -> Result<(), AcceptanceError> {
    let CommandAction::Edit {
        expected_version,
        content,
        ..
    } = &context.input.action
    else {
        return Ok(());
    };
    if message.author_id != context.actor.user_id || message.service_kind.is_some() {
        return Err(AccountError::NotFound.into());
    }
    access::authorize_send(connection, context.actor, context.conversation).await?;
    if parse_sequence(expected_version)? != parse_sequence(&message.version)? {
        return Err(AccountError::MessageConflict.into());
    }
    let content = if message.has_attachments {
        super::content::validate_caption(content.clone())?
    } else {
        validate_content(content.clone())?
    };
    sqlx::query(
        "UPDATE messages SET content = $2, version = version + 1, edited_at = now() WHERE id = $1",
    )
    .bind(message.id)
    .bind(sqlx::types::Json(content))
    .execute(connection)
    .await?;

    Ok(())
}

async fn set_reaction(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
) -> Result<(), AcceptanceError> {
    let CommandAction::Reaction {
        message_id,
        emoji,
        is_selected,
    } = &context.input.action
    else {
        return Ok(());
    };
    if !ALLOWED_REACTIONS.contains(&emoji.as_str()) {
        return Err(AccountError::Validation("unsupported reaction").into());
    }
    if !is_selected {
        let delete = sqlx::query(
            "DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3",
        )
        .bind(message_id)
        .bind(context.actor.user_id)
        .bind(emoji);
        delete.execute(connection).await?;
        return Ok(());
    }
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM message_reactions
         WHERE message_id = $1 AND user_id = $2 AND emoji <> $3",
    )
    .bind(message_id)
    .bind(context.actor.user_id)
    .bind(emoji);
    if count.fetch_one(&mut *connection).await? >= MAX_REACTIONS_PER_ACCOUNT {
        return Err(AccountError::QuotaExceeded.into());
    }
    let insert = sqlx::query(
        "INSERT INTO message_reactions (message_id, user_id, emoji)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    )
    .bind(message_id)
    .bind(context.actor.user_id)
    .bind(emoji);
    insert.execute(connection).await?;

    Ok(())
}

async fn apply(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
) -> Result<(), AcceptanceError> {
    let message = command_message(connection, context).await?;
    match &context.input.action {
        CommandAction::Edit {
            ..
        } => edit(connection, context, &message).await?,
        CommandAction::Delete {
            ..
        } => {
            if message.author_id != context.actor.user_id {
                if !context.conversation.is_community() {
                    return Err(AccountError::NotFound.into());
                }
                access::require_manager(connection, context.actor, context.conversation).await?;
            }
            sqlx::query(
                "UPDATE messages SET deleted_at = now(), version = version + 1,
                 content = '{\"schema_version\":1,\"text\":\"\",\"custom_emoji\":[]}'::jsonb,
                 body = NULL, forwarded_from = NULL, reply_quote = NULL, is_pinned = false
                 WHERE id = $1",
            )
            .bind(message.id)
            .execute(&mut *connection)
            .await?;
            crate::media::references::detach_message(connection, message.id).await?;
            super::polls::delete(connection, message.id).await?;
            super::checklists::delete(connection, message.id).await?;
            // Scrub stored excerpts as well as read projections; the target identity remains.
            sqlx::query("UPDATE messages SET reply_quote = NULL WHERE reply_id = $1")
                .bind(message.id)
                .execute(&mut *connection)
                .await?;
            sqlx::query("DELETE FROM message_reactions WHERE message_id = $1")
                .bind(message.id)
                .execute(&mut *connection)
                .await?;
        }
        CommandAction::HideMessage {
            ..
        } => {
            sqlx::query(
                "INSERT INTO hidden_messages (user_id, message_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING",
            )
            .bind(context.actor.user_id)
            .bind(message.id)
            .execute(&mut *connection)
            .await?;
        }
        CommandAction::Reaction {
            ..
        } => {
            set_reaction(connection, context).await?;
            advance_interaction(connection, message.id).await?;
        }
        CommandAction::Pin {
            is_pinned,
            ..
        } => {
            access::require_manager(connection, context.actor, context.conversation).await?;
            sqlx::query(
                "UPDATE messages SET is_pinned = $2, interaction_version = interaction_version + 1
                 WHERE id = $1",
            )
            .bind(message.id)
            .bind(is_pinned)
            .execute(&mut *connection)
            .await?;
        }
        CommandAction::VotePoll {
            ..
        }
        | CommandAction::EditPoll {
            ..
        }
        | CommandAction::AddPollOption {
            ..
        }
        | CommandAction::ClosePoll {
            ..
        } => {
            super::polls::apply(connection, context, &message).await?;
            advance_interaction(connection, message.id).await?;
        }
        CommandAction::SetChecklistTask {
            ..
        }
        | CommandAction::AppendChecklistTasks {
            ..
        }
        | CommandAction::EditChecklist {
            ..
        } => {
            super::checklists::apply(connection, context, &message).await?;
            advance_interaction(connection, message.id).await?;
        }
        _ => return Err(AccountError::Validation("expected a message action").into()),
    }

    Ok(())
}

async fn apply_batch(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
) -> Result<Option<Vec<Uuid>>, AcceptanceError> {
    let (ids, is_personal) = match &context.input.action {
        CommandAction::BatchHide {
            message_ids,
        } => (message_ids, true),
        CommandAction::BatchDelete {
            message_ids,
        } => (message_ids, false),
        _ => return Ok(None),
    };
    super::forwarding::validate_message_ids(ids)?;

    // Every item uses the normal visibility and mutation rules in this same transaction.
    for message_id in ids {
        let action = if is_personal {
            CommandAction::HideMessage {
                message_id: *message_id,
            }
        } else {
            CommandAction::Delete {
                message_id: *message_id,
            }
        };
        let input = MessageCommand {
            action,
            ..context.input.clone()
        };
        let item = CommandContext {
            input: &input,
            ..*context
        };
        apply(connection, &item).await?;
    }

    Ok(Some(ids.clone()))
}

/// Invalidate older projections after changing the authoritative interaction state.
pub(crate) async fn advance_interaction(
    connection: &mut PgConnection,
    message_id: Uuid,
) -> Result<(), sqlx::Error> {
    let update = sqlx::query(
        "UPDATE messages SET interaction_version = interaction_version + 1 WHERE id = $1",
    );
    update.bind(message_id).execute(connection).await?;

    Ok(())
}

impl MessageService {
    /// Read the current authorized command resources for an explicit conflict response.
    pub(crate) async fn command_snapshot(
        &self,
        actor: Actor,
        input: &MessageCommand,
    ) -> Result<CommandReceipt, AccountError> {
        let mut transaction = self.snapshot(&actor).await?;
        let conversation =
            match conversations::view(&mut transaction, actor.user_id, input.conversation_id).await
            {
                Ok(conversation) => Some(conversation),
                Err(AccountError::NotFound) => None,
                Err(error) => return Err(error),
            };
        let message = if let Some(message_id) =
            input.action.message_id().filter(|_| conversation.is_some())
        {
            let receipt = acceptance::receipt(&mut transaction, actor.user_id, message_id).await;
            match receipt {
                Ok(receipt) if receipt.message.conversation_id == input.conversation_id => {
                    Some(receipt.message)
                }
                Ok(_) | Err(AccountError::NotFound) => None,
                Err(error) => return Err(error),
            }
        } else {
            None
        };
        let scope = crate::sync::cursor::CursorScope::read(&mut transaction, actor.user_id).await?;
        transaction.commit().await?;

        Ok(CommandReceipt {
            observation_cursor: scope.encode(scope.position),
            conversation,
            message,
        })
    }

    /// Apply one idempotent lifecycle command under the conversation and participant locks.
    pub async fn command(
        &self,
        actor: Actor,
        mut input: MessageCommand,
    ) -> Result<CommandReceipt, AccountError> {
        // Hash normalized checklist content so insignificant whitespace does not break replay.
        match &mut input.action {
            CommandAction::EditChecklist {
                checklist,
                ..
            } => {
                super::checklists::normalize(checklist)?;
            }
            CommandAction::AppendChecklistTasks {
                tasks,
                ..
            } => {
                super::checklists::normalize_tasks(tasks)?;
            }
            _ => {}
        }

        for attempt in 0..TRANSACTION_ATTEMPTS {
            match self.accept_command(&actor, &input).await {
                Ok(receipt) => return Ok(receipt),
                Err(error) if error.is_retryable() && attempt + 1 < TRANSACTION_ATTEMPTS => {
                    continue;
                }
                Err(error) => return Err(error.into_public()),
            }
        }
        Err(AccountError::Unavailable)
    }

    async fn accept_command(
        &self,
        actor: &Actor,
        input: &MessageCommand,
    ) -> Result<CommandReceipt, AcceptanceError> {
        let encoded = serde_json::to_vec(input).map_err(|_| AccountError::Unavailable)?;
        let hash = Sha256::digest(encoded).to_vec();
        let mut transaction = self.accounts.pool.begin().await?;
        let destination = Destination::Conversation {
            conversation_id: input.conversation_id,
        };
        let conversation = access::lock_conversation(&mut transaction, actor, &destination).await?;
        access::lock_participants(&mut transaction, &conversation).await?;
        lock_actor(&mut transaction, actor, &self.accounts.settings).await?;

        let previous = sqlx::query_as::<_, (Vec<u8>, Option<Uuid>)>(
            "SELECT payload_hash, message_id FROM command_receipts WHERE actor_id = $1 AND operation_id = $2",
        )
        .bind(actor.user_id)
        .bind(input.operation_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let message_id;
        if let Some((previous, previous_message_id)) = previous {
            if previous != hash {
                return Err(AccountError::MessageConflict.into());
            }
            message_id = previous_message_id;
        } else {
            conversations::view(&mut transaction, actor.user_id, conversation.id).await?;
            let is_send_identity: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM message_identities
                 WHERE author_id = $1 AND operation_id = $2)",
            )
            .bind(actor.user_id)
            .bind(input.operation_id)
            .fetch_one(&mut *transaction)
            .await?;
            let is_forward_identity = super::forwarding::operation_exists(
                &mut transaction,
                actor.user_id,
                input.operation_id,
            )
            .await?;
            if is_send_identity || is_forward_identity {
                return Err(AccountError::MessageConflict.into());
            }
            let context = CommandContext {
                actor,
                input,
                conversation: &conversation,
            };
            let batch_ids = apply_batch(&mut transaction, &context).await?;
            message_id = if batch_ids.is_some() {
                None
            } else if input.action.message_id().is_some() {
                apply(&mut transaction, &context).await?;
                input.action.message_id()
            } else {
                conversations::state::apply(&mut transaction, &context).await?
            };
            repair_unread(&mut transaction, conversation.id).await?;
            sqlx::query("UPDATE conversations SET version = version + 1 WHERE id = $1")
                .bind(conversation.id)
                .execute(&mut *transaction)
                .await?;
            let is_personal = matches!(
                input.action,
                CommandAction::HideMessage { .. }
                    | CommandAction::BatchHide { .. }
                    | CommandAction::Draft { .. }
                    | CommandAction::Preferences { .. }
                    | CommandAction::Clear
                    | CommandAction::Close
            );
            let participants = if is_personal {
                vec![actor.user_id]
            } else {
                access::participants(&mut transaction, &conversation).await?
            };
            let changed: Vec<Option<Uuid>> = match batch_ids {
                Some(ids) => ids.into_iter().map(Some).collect(),
                None => vec![message_id],
            };
            for id in changed {
                let group = ChangeGroup {
                    participants: &participants,
                    conversation_id: conversation.id,
                    message_id: id,
                };
                changes::append(&mut transaction, group).await?;
            }
            let insert = sqlx::query(
                "INSERT INTO command_receipts
                 (actor_id, operation_id, payload_hash, conversation_id, message_id)
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(actor.user_id)
            .bind(input.operation_id);
            let insert = insert.bind(hash).bind(conversation.id).bind(message_id);
            insert.execute(&mut *transaction).await?;
        }
        let conversation =
            match conversations::view(&mut transaction, actor.user_id, conversation.id).await {
                Ok(conversation) => Some(conversation),
                Err(AccountError::NotFound) => None,
                Err(error) => return Err(error.into()),
            };
        let message = if let Some(message_id) = message_id.filter(|_| conversation.is_some()) {
            Some(acceptance::receipt(&mut transaction, actor.user_id, message_id).await?.message)
        } else {
            None
        };
        let scope = crate::sync::cursor::CursorScope::read(&mut transaction, actor.user_id).await?;
        transaction.commit().await?;

        Ok(CommandReceipt {
            observation_cursor: scope.encode(scope.position),
            conversation,
            message,
        })
    }
}
