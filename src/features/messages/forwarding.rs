use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgConnection, QueryBuilder};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{
    CanonicalMessage, Destination, MessageService, SendMessage, acceptance,
    bodies::{MessageBodyView, StoredMessageBody},
    commands::CommandContext,
    content::{MessageContent, validate_content},
    projection,
    service::{AcceptanceError, retry_transaction},
};
use crate::features::{
    accounts::{AccountError, Actor, sessions::lock_actor},
    conversations::{self, ConversationView, access},
    media::references,
    sync::cursor::CursorScope,
};

const MAX_BATCH_MESSAGES: usize = 20;

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ForwardItem {
    pub source_message_id: Uuid,
    pub message_id: Uuid,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ForwardComment {
    pub message_id: Uuid,
    pub content: MessageContent,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ForwardBatch {
    pub operation_id: Uuid,
    pub destination: Destination,
    pub items: Vec<ForwardItem>,
    // Preserve the hash of existing requests that had no comment.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<ForwardComment>,
}

#[derive(Serialize, ToSchema)]
pub struct ForwardReceipt {
    pub observation_cursor: String,
    pub conversation: Option<ConversationView>,
    pub message_ids: Vec<Uuid>,
    pub messages: Vec<CanonicalMessage>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
pub struct ChecklistSnapshotTask {
    pub id: Uuid,
    pub text: String,
    pub is_complete: bool,
}

#[derive(FromRow)]
struct BatchRecord {
    payload_hash: Vec<u8>,
    conversation_id: Uuid,
    message_ids: Vec<Uuid>,
}

struct BatchIdentity<'a> {
    actor: &'a Actor,
    input: &'a ForwardBatch,
    hash: &'a [u8],
}

struct SourceQuery {
    user_id: Uuid,
    message_id: Uuid,
}

/// Reject oversize or duplicate selections before taking conversation locks.
pub(super) fn validate_message_ids(ids: &[Uuid]) -> Result<(), AccountError> {
    if ids.is_empty() || ids.len() > MAX_BATCH_MESSAGES {
        return Err(AccountError::Validation("select between one and twenty messages"));
    }
    let unique: HashSet<_> = ids.iter().collect();
    if unique.len() != ids.len() {
        return Err(AccountError::Validation("duplicate message in batch"));
    }

    Ok(())
}

async fn find_batch(
    connection: &mut PgConnection,
    request: &BatchIdentity<'_>,
) -> Result<Option<BatchRecord>, AcceptanceError> {
    let query = sqlx::query_as::<_, BatchRecord>(
        "SELECT payload_hash, conversation_id, message_ids FROM message_forward_batches
         WHERE actor_id = $1 AND operation_id = $2",
    );
    let query = query.bind(request.actor.user_id).bind(request.input.operation_id);
    let record = query.fetch_optional(connection).await?;
    if record.as_ref().is_some_and(|record| record.payload_hash != request.hash) {
        return Err(AccountError::MessageConflict.into());
    }

    Ok(record)
}

async fn receipt(
    connection: &mut PgConnection,
    user_id: Uuid,
    record: BatchRecord,
) -> Result<ForwardReceipt, AcceptanceError> {
    let conversation = match conversations::view(connection, user_id, record.conversation_id).await
    {
        Ok(conversation) => Some(conversation),
        Err(AccountError::NotFound) => None,
        Err(error) => return Err(error.into()),
    };
    let mut messages = Vec::with_capacity(record.message_ids.len());
    if conversation.is_some() {
        for message_id in &record.message_ids {
            let accepted = acceptance::receipt(connection, user_id, *message_id).await?;
            messages.push(accepted.message);
        }
    }
    let scope = CursorScope::read(connection, user_id).await?;

    Ok(ForwardReceipt {
        observation_cursor: scope.encode(scope.position),
        conversation,
        message_ids: record.message_ids,
        messages,
    })
}

async fn source_conversations(
    connection: &mut PgConnection,
    request: &BatchIdentity<'_>,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let message_ids: Vec<_> =
        request.input.items.iter().map(|item| item.source_message_id).collect();
    let mut query = QueryBuilder::new(
        "SELECT DISTINCT message.conversation_id FROM messages message WHERE message.id = ANY(",
    );
    query.push_bind(message_ids);
    query.push(")");
    projection::restrict_visible(&mut query, request.actor.user_id);

    query.build_query_scalar().fetch_all(connection).await
}

async fn source(
    connection: &mut PgConnection,
    input: SourceQuery,
) -> Result<CanonicalMessage, AcceptanceError> {
    let mut query = QueryBuilder::new(acceptance::MESSAGE_SELECT);
    query.push(" WHERE message.id = ").push_bind(input.message_id);
    projection::restrict_visible(&mut query, input.user_id);
    let message = query.build_query_as::<CanonicalMessage>().fetch_optional(&mut *connection);
    let mut message = message.await?.ok_or(AccountError::NotFound)?;
    let check = sqlx::query_scalar("SELECT forwarding_enabled FROM conversations WHERE id = $1");
    let can_forward: bool = check.bind(message.conversation_id).fetch_one(&mut *connection).await?;
    if !can_forward || message.service_kind.is_some() {
        return Err(AccountError::ConversationUnavailable.into());
    }

    projection::personalize(connection, input.user_id, &mut message).await?;
    Ok(message)
}

/// Capture displayable typed content without interaction identities or private results.
pub(crate) fn snapshot_body(body: Option<MessageBodyView>) -> Option<StoredMessageBody> {
    let copied = match body? {
        MessageBodyView::Sticker {
            sticker_id,
        } => StoredMessageBody::Sticker {
            sticker_id,
        },
        MessageBodyView::Contact {
            display_name,
            account_id,
            phone,
        } => StoredMessageBody::Contact {
            display_name,
            account_id,
            phone,
        },
        MessageBodyView::Poll(poll) => StoredMessageBody::PollSnapshot {
            question: poll.question,
            options: poll
                .options
                .into_iter()
                .map(|option| super::polls::PollOptionInput {
                    id: option.id,
                    text: option.text,
                })
                .collect(),
        },
        MessageBodyView::Checklist(checklist) => StoredMessageBody::ChecklistSnapshot {
            title: checklist.title,
            tasks: checklist
                .tasks
                .into_iter()
                .map(|task| ChecklistSnapshotTask {
                    id: task.id,
                    text: task.text,
                    is_complete: task.is_complete,
                })
                .collect(),
        },
        MessageBodyView::PollSnapshot {
            question,
            options,
        } => StoredMessageBody::PollSnapshot {
            question,
            options,
        },
        MessageBodyView::ChecklistSnapshot {
            title,
            tasks,
        } => StoredMessageBody::ChecklistSnapshot {
            title,
            tasks,
        },
    };

    Some(copied)
}

struct CopyContext<'a> {
    request: &'a BatchIdentity<'a>,
    destination: &'a access::LockedConversation,
    item: &'a ForwardItem,
    source: CanonicalMessage,
}

struct CopyBatch<'a> {
    request: &'a BatchIdentity<'a>,
    destination: &'a access::LockedConversation,
    source_conversations: &'a [Uuid],
}

async fn insert_copy(
    connection: &mut PgConnection,
    copy: CopyContext<'_>,
) -> Result<(), AcceptanceError> {
    let attribution = copy.source.forwarded_from.as_deref().unwrap_or(&copy.source.author_name);
    let body = snapshot_body(copy.source.body);
    let input = SendMessage {
        operation_id: Uuid::new_v4(),
        message_id: copy.item.message_id,
        destination: Destination::Conversation {
            conversation_id: copy.destination.id,
        },
        content: copy.source.content,
        attachments: Vec::new(),
        reply: None,
        draft_version: None,
        body: None,
        disable_link_preview: copy.source.disable_link_preview,
    };
    let source = acceptance::ForwardSource {
        message_id: copy.source.id,
        attribution,
    };
    let new = acceptance::NewMessage {
        actor: copy.request.actor,
        input: &input,
        payload_hash: copy.request.hash,
        conversation: copy.destination,
        body: body.as_ref(),
        forward: Some(source),
    };
    acceptance::insert(connection, new).await
}

async fn store_batch(
    connection: &mut PgConnection,
    request: &BatchIdentity<'_>,
    conversation_id: Uuid,
) -> Result<BatchRecord, sqlx::Error> {
    let mut message_ids = Vec::with_capacity(request.input.items.len() + 1);
    if let Some(comment) = &request.input.comment {
        message_ids.push(comment.message_id);
    }
    message_ids.extend(request.input.items.iter().map(|item| item.message_id));
    let insert = sqlx::query(
        "INSERT INTO message_forward_batches
         (actor_id, operation_id, payload_hash, conversation_id, message_ids)
         VALUES ($1, $2, $3, $4, $5)",
    );
    let insert = insert.bind(request.actor.user_id).bind(request.input.operation_id);
    let insert = insert.bind(request.hash).bind(conversation_id).bind(&message_ids);
    insert.execute(connection).await?;

    Ok(BatchRecord {
        payload_hash: request.hash.to_vec(),
        conversation_id,
        message_ids,
    })
}

/// Return whether a stable operation is already bound to a forwarding batch.
pub(crate) async fn operation_exists(
    connection: &mut PgConnection,
    actor_id: Uuid,
    operation_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let query = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM message_forward_batches
         WHERE actor_id = $1 AND operation_id = $2)",
    );
    let query = query.bind(actor_id).bind(operation_id);
    query.fetch_one(connection).await
}

async fn reject_other_operations(
    connection: &mut PgConnection,
    request: &BatchIdentity<'_>,
) -> Result<(), AcceptanceError> {
    let query = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM message_identities WHERE author_id = $1 AND operation_id = $2)
             OR EXISTS (SELECT 1 FROM command_receipts WHERE actor_id = $1 AND operation_id = $2)",
    );
    let query = query.bind(request.actor.user_id).bind(request.input.operation_id);
    let is_taken: bool = query.fetch_one(connection).await?;
    if is_taken {
        return Err(AccountError::MessageConflict.into());
    }

    Ok(())
}

impl MessageService {
    /// Copy one bounded destination batch or reconcile its stable accepted identity.
    pub async fn forward(
        &self,
        actor: Actor,
        mut input: ForwardBatch,
    ) -> Result<ForwardReceipt, AccountError> {
        let sources: Vec<_> = input.items.iter().map(|item| item.source_message_id).collect();
        let outputs: Vec<_> = input.items.iter().map(|item| item.message_id).collect();
        validate_message_ids(&sources)?;
        validate_message_ids(&outputs)?;
        if let Some(comment) = &mut input.comment {
            if outputs.contains(&comment.message_id) {
                return Err(AccountError::Validation("duplicate message in batch"));
            }
            comment.content = validate_content(comment.content.clone())?;
        }
        let encoded = serde_json::to_vec(&input).map_err(|_| AccountError::Unavailable)?;
        let hash = Sha256::digest(encoded);
        let request = BatchIdentity {
            actor: &actor,
            input: &input,
            hash: hash.as_slice(),
        };

        retry_transaction(|| self.accept_forward(&request)).await
    }

    async fn accept_forward(
        &self,
        request: &BatchIdentity<'_>,
    ) -> Result<ForwardReceipt, AcceptanceError> {
        // A replay remains valid even after the source was deleted or protected.
        let mut snapshot = self.snapshot(request.actor).await?;
        if let Some(previous) = find_batch(&mut snapshot, request).await? {
            let accepted = receipt(&mut snapshot, request.actor.user_id, previous).await?;
            snapshot.commit().await?;
            return Ok(accepted);
        }
        snapshot.commit().await?;

        let mut transaction = self.accounts.pool.begin().await?;
        let destination_id = access::resolve_destination(
            &mut transaction,
            request.actor,
            &request.input.destination,
        )
        .await?;
        let mut conversation_ids = source_conversations(&mut transaction, request).await?;
        conversation_ids.push(destination_id);
        conversation_ids.sort_unstable();
        conversation_ids.dedup();

        // Reverse-direction forwards take the same conversation order before any account locks.
        let conversations =
            access::lock_conversations(&mut transaction, request.actor, &conversation_ids).await?;
        access::lock_multiple_participants(&mut transaction, &conversations).await?;
        lock_actor(&mut transaction, request.actor, &self.accounts.settings).await?;
        if let Some(previous) = find_batch(&mut transaction, request).await? {
            let accepted = receipt(&mut transaction, request.actor.user_id, previous).await?;
            transaction.commit().await?;
            return Ok(accepted);
        }
        reject_other_operations(&mut transaction, request).await?;
        let destination = conversations.iter().find(|entry| entry.id == destination_id);
        let destination = destination.ok_or(AccountError::NotFound)?;
        access::authorize_send(&mut transaction, request.actor, destination).await?;

        let locked_ids: Vec<_> = conversations.iter().map(|entry| entry.id).collect();
        let copies = CopyBatch {
            request,
            destination,
            source_conversations: &locked_ids,
        };
        let record = copy_sources(&mut transaction, copies).await?;
        let accepted = receipt(&mut transaction, request.actor.user_id, record).await?;
        transaction.commit().await?;

        Ok(accepted)
    }
}

async fn copy_sources(
    connection: &mut PgConnection,
    batch: CopyBatch<'_>,
) -> Result<BatchRecord, AcceptanceError> {
    let request = batch.request;
    let mut sources = Vec::with_capacity(request.input.items.len());
    for item in &request.input.items {
        let input = SourceQuery {
            user_id: request.actor.user_id,
            message_id: item.source_message_id,
        };
        let visible = source(connection, input).await?;
        // Membership may have changed since the discovery query. Copy only from locked chats.
        if !batch.source_conversations.contains(&visible.conversation_id) {
            return Err(AccountError::NotFound.into());
        }
        sources.push(visible);
    }
    let source_ids: Vec<_> = sources.iter().map(|message| message.id).collect();
    // Every immutable file is locked before the first copy advances feed heads.
    references::lock_forward_files(connection, &source_ids).await?;
    access::admit_members(connection, batch.destination).await?;

    // Expiry can pass while waiting for a conversation or file lock, even without a write.
    let expiry = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM messages
         WHERE id = ANY($1) AND expires_at <= clock_timestamp())",
    );
    let has_expired_source: bool = expiry.bind(&source_ids).fetch_one(&mut *connection).await?;
    if has_expired_source {
        return Err(AccountError::NotFound.into());
    }

    // Store the comment before the copies so every retry returns the same ordered batch.
    if let Some(comment) = &request.input.comment {
        insert_comment(connection, &batch, comment).await?;
    }
    for (item, source) in request.input.items.iter().zip(sources) {
        let copy = CopyContext {
            request,
            destination: batch.destination,
            item,
            source,
        };
        insert_copy(connection, copy).await?;
    }

    Ok(store_batch(connection, request, batch.destination.id).await?)
}

async fn insert_comment(
    connection: &mut PgConnection,
    batch: &CopyBatch<'_>,
    comment: &ForwardComment,
) -> Result<(), AcceptanceError> {
    let input = SendMessage {
        operation_id: Uuid::new_v4(),
        message_id: comment.message_id,
        destination: Destination::Conversation {
            conversation_id: batch.destination.id,
        },
        content: comment.content.clone(),
        attachments: Vec::new(),
        reply: None,
        draft_version: None,
        body: None,
        disable_link_preview: None,
    };
    let message = acceptance::NewMessage {
        actor: batch.request.actor,
        input: &input,
        payload_hash: batch.request.hash,
        conversation: batch.destination,
        body: None,
        forward: None,
    };

    acceptance::insert(connection, message).await
}

/// Update forwarding policy under the locked conversation's ownership and consent rules.
pub(crate) async fn set_policy(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
) -> Result<(), AcceptanceError> {
    let super::CommandAction::SetForwardingPolicy {
        is_enabled,
    } = context.input.action
    else {
        return Err(AccountError::Validation("expected a forwarding policy action").into());
    };
    if context.conversation.kind == "direct" && is_enabled {
        let actor_is_low = context.conversation.participant_low == Some(context.actor.user_id);
        let update = sqlx::query(
            "UPDATE conversations SET
               forwarding_low_consent = forwarding_low_consent OR $2,
               forwarding_high_consent = forwarding_high_consent OR NOT $2,
               forwarding_enabled = forwarding_enabled OR
                   ((forwarding_low_consent OR $2) AND (forwarding_high_consent OR NOT $2))
             WHERE id = $1",
        );
        update.bind(context.conversation.id).bind(actor_is_low).execute(connection).await?;
        return Ok(());
    }

    if context.conversation.is_community() {
        let query = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = $1
             AND user_id = $2 AND directory_active AND NOT is_banned AND role = 'owner')",
        );
        let query = query.bind(context.conversation.id).bind(context.actor.user_id);
        let is_owner: bool = query.fetch_one(&mut *connection).await?;
        if !is_owner {
            return Err(AccountError::NotFound.into());
        }
    }

    // A direct disable invalidates both approvals, even if forwarding was already off.
    let update = sqlx::query(
        "UPDATE conversations SET forwarding_enabled = $2, forwarding_low_consent = false,
            forwarding_high_consent = false WHERE id = $1",
    );
    update.bind(context.conversation.id).bind(is_enabled).execute(connection).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::ForwardBatch;
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn accepts_a_forward_with_a_separate_comment() {
        let input = json!({
            "operation_id": Uuid::new_v4(),
            "destination": {"kind": "saved"},
            "items": [{
                "source_message_id": Uuid::new_v4(),
                "message_id": Uuid::new_v4(),
            }],
            "comment": {
                "message_id": Uuid::new_v4(),
                "content": {
                    "schema_version": 1,
                    "text": "Please review this",
                    "custom_emoji": [],
                },
            },
        });

        let parsed = serde_json::from_value::<ForwardBatch>(input.clone()).unwrap();
        let serialized = serde_json::to_value(parsed).unwrap();
        assert_eq!(serialized["comment"]["content"]["text"], input["comment"]["content"]["text"]);
    }
}
