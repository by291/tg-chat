use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgConnection;
use uuid::Uuid;

use super::{
    access,
    community_model::{
        CommunityAction, CommunityCommand, CommunityContext, CommunityRecord, CommunitySettings,
        CreateCommunity,
    },
    invitations, membership,
};
use crate::{
    accounts::{AccountError, Actor, sessions::lock_actor},
    messages::{CommandReceipt, MessageService, service::AcceptanceError},
    sync::{
        changes::{self, ChangeGroup},
        cursor::CursorScope,
    },
};

const TRANSACTION_ATTEMPTS: usize = 3;
const MAX_TITLE_CHARACTERS: usize = 128;
const MAX_DESCRIPTION_CHARACTERS: usize = 2000;
const MIN_HANDLE_LENGTH: usize = 3;
const MAX_HANDLE_LENGTH: usize = 32;

fn normalize_settings(mut settings: CommunitySettings) -> Result<CommunitySettings, AccountError> {
    settings.title = settings.title.trim().to_owned();
    let is_valid_title =
        !settings.title.is_empty() && settings.title.chars().count() <= MAX_TITLE_CHARACTERS;
    if !is_valid_title || settings.description.chars().count() > MAX_DESCRIPTION_CHARACTERS {
        return Err(AccountError::Validation("community title or description exceeds its bounds"));
    }
    if let Some(public_handle) = settings.public_handle.as_mut() {
        let has_valid_length =
            (MIN_HANDLE_LENGTH..=MAX_HANDLE_LENGTH).contains(&public_handle.len());
        let has_valid_characters =
            public_handle.bytes().all(|letter| letter.is_ascii_alphanumeric() || letter == b'_');
        if !has_valid_length || !has_valid_characters {
            return Err(AccountError::Validation(
                "public handles require 3-32 ASCII letters, digits, or underscores",
            ));
        }
        public_handle.make_ascii_lowercase();
    }
    if settings.is_public && settings.public_handle.is_none() {
        return Err(AccountError::Validation("public communities require a public handle"));
    }
    Ok(settings)
}

fn payload_hash(input: &impl Serialize) -> Result<Vec<u8>, AccountError> {
    let encoded = serde_json::to_vec(input).map_err(|_| AccountError::Unavailable)?;
    Ok(Sha256::digest(encoded).to_vec())
}

pub(crate) struct OperationIdentity<'a> {
    pub actor_id: Uuid,
    pub operation_id: Uuid,
    pub conversation_id: Uuid,
    pub hash: &'a [u8],
}

async fn is_replay(
    connection: &mut PgConnection,
    identity: &OperationIdentity<'_>,
) -> Result<bool, AcceptanceError> {
    let previous = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT payload_hash FROM command_receipts WHERE actor_id = $1 AND operation_id = $2",
    )
    .bind(identity.actor_id)
    .bind(identity.operation_id)
    .fetch_optional(&mut *connection)
    .await?;
    if let Some(previous) = previous {
        if previous != identity.hash {
            return Err(AccountError::MessageConflict.into());
        }
        return Ok(true);
    }
    let is_send: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM message_identities WHERE author_id = $1 AND operation_id = $2)",
    )
    .bind(identity.actor_id)
    .bind(identity.operation_id)
    .fetch_one(connection)
    .await?;
    if is_send {
        return Err(AccountError::MessageConflict.into());
    }
    Ok(false)
}

async fn remember(
    connection: &mut PgConnection,
    identity: &OperationIdentity<'_>,
) -> Result<(), AcceptanceError> {
    let insert = sqlx::query(
        "INSERT INTO command_receipts (actor_id, operation_id, conversation_id, payload_hash)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(identity.actor_id)
    .bind(identity.operation_id);
    let insert = insert.bind(identity.conversation_id).bind(identity.hash);
    insert.execute(connection).await?;
    Ok(())
}

async fn receipt(
    connection: &mut PgConnection,
    identity: &OperationIdentity<'_>,
) -> Result<CommandReceipt, AcceptanceError> {
    let conversation =
        match super::view(connection, identity.actor_id, identity.conversation_id).await {
            Ok(conversation) => Some(conversation),
            Err(AccountError::NotFound) => None,
            Err(error) => return Err(error.into()),
        };
    let scope = CursorScope::read(connection, identity.actor_id).await?;
    Ok(CommandReceipt {
        observation_cursor: scope.encode(scope.position),
        conversation,
        message: None,
    })
}

/// Read an ordinary community under its write lock, including tombstones for safe replay.
pub(crate) async fn lock_community(
    connection: &mut PgConnection,
    id: Uuid,
) -> Result<CommunityRecord, AcceptanceError> {
    let query = sqlx::query_as(
        "SELECT * FROM conversations WHERE id = $1 AND kind IN ('group', 'channel')
         AND NOT is_quarantined FOR UPDATE",
    )
    .bind(id);
    query.fetch_optional(connection).await?.ok_or(AccountError::NotFound.into())
}

async fn recipients(connection: &mut PgConnection, id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT user_id FROM conversation_members WHERE conversation_id = $1
         AND directory_active AND NOT is_banned ORDER BY user_id",
    )
    .bind(id)
    .fetch_all(connection)
    .await
}

async fn lock_accounts(
    connection: &mut PgConnection,
    accounts: &[Uuid],
) -> Result<(), AcceptanceError> {
    let locked = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE id = ANY($1) ORDER BY id FOR UPDATE",
    )
    .bind(accounts)
    .fetch_all(connection)
    .await?;
    if locked.len() != accounts.len() {
        return Err(AccountError::ConversationUnavailable.into());
    }
    Ok(())
}

async fn update_avatar(
    connection: &mut PgConnection,
    context: &CommunityContext<'_>,
) -> Result<(), AcceptanceError> {
    use crate::media::avatars::{AvatarChange, prepare_avatar};

    membership::require_manager(connection, context).await?;
    let CommunityAction::Avatar {
        expected_version,
        file_id,
    } = &context.command.action
    else {
        return Err(AccountError::Validation("expected community avatar").into());
    };
    let expected_version = crate::messages::history::parse_sequence(expected_version)?;
    let current = sqlx::query_as::<_, (i64, Option<Uuid>)>(
        "SELECT settings_version, avatar_file_id FROM conversations WHERE id = $1",
    )
    .bind(context.community.id);
    let (version, previous) = current.fetch_one(&mut *connection).await?;
    if version != expected_version {
        return Err(AccountError::Conflict.into());
    }

    prepare_avatar(
        connection,
        AvatarChange {
            actor_id: context.actor.user_id,
            previous,
            next: *file_id,
        },
    )
    .await?;
    let update = sqlx::query(
        "UPDATE conversations SET avatar_file_id = $2, settings_version = settings_version + 1
         WHERE id = $1",
    )
    .bind(context.community.id)
    .bind(file_id);
    update.execute(connection).await?;

    Ok(())
}

async fn update_settings(
    connection: &mut PgConnection,
    context: &CommunityContext<'_>,
    settings: CommunitySettings,
) -> Result<(), AcceptanceError> {
    membership::require_manager(connection, context).await?;
    let CommunityAction::Settings {
        expected_version,
        ..
    } = &context.command.action
    else {
        return Err(AccountError::Validation("expected community settings").into());
    };
    let expected_version = crate::messages::history::parse_sequence(expected_version)?;
    let settings = normalize_settings(settings)?;
    let update = sqlx::query(
        "UPDATE conversations SET title = $2, description = $3, public_handle = $4,
         is_public = $5, requires_approval = $6, settings_version = settings_version + 1
         WHERE id = $1 AND settings_version = $7",
    )
    .bind(context.community.id)
    .bind(settings.title)
    .bind(settings.description);
    let update = update
        .bind(settings.public_handle)
        .bind(settings.is_public)
        .bind(settings.requires_approval);
    let update = update.bind(expected_version);
    if update.execute(&mut *connection).await?.rows_affected() != 1 {
        return Err(AccountError::MessageConflict.into());
    }
    if context.community.is_public && !settings.is_public {
        // A public request never becomes a private invitation when visibility changes.
        let invalidate = sqlx::query(
            "DELETE FROM community_join_requests WHERE conversation_id = $1 AND invitation_id IS NULL",
        )
        .bind(context.community.id);
        invalidate.execute(connection).await?;
    }
    Ok(())
}

impl MessageService {
    /// Create one community and its owner membership atomically with directory admission.
    pub async fn create_community(
        &self,
        actor: Actor,
        mut input: CreateCommunity,
    ) -> Result<CommandReceipt, AccountError> {
        if !matches!(input.kind.as_str(), "group" | "channel") {
            return Err(AccountError::Validation("expected group or channel"));
        }
        input.settings = normalize_settings(input.settings)?;
        for attempt in 0..TRANSACTION_ATTEMPTS {
            match self.accept_community_creation(&actor, &input).await {
                Ok(receipt) => return Ok(receipt),
                Err(error) if error.is_retryable() && attempt + 1 < TRANSACTION_ATTEMPTS => {
                    continue;
                }
                Err(error) => return Err(error.into_public()),
            }
        }
        Err(AccountError::Unavailable)
    }

    async fn accept_community_creation(
        &self,
        actor: &Actor,
        input: &CreateCommunity,
    ) -> Result<CommandReceipt, AcceptanceError> {
        let hash = payload_hash(input)?;
        let identity = OperationIdentity {
            actor_id: actor.user_id,
            operation_id: input.operation_id,
            conversation_id: input.conversation_id,
            hash: &hash,
        };
        let mut transaction = self.accounts.pool.begin().await?;
        let insert = sqlx::query(
            "INSERT INTO conversations (id, kind, owner_id, title, description, public_handle,
                is_public, requires_approval) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(input.conversation_id)
        .bind(&input.kind)
        .bind(actor.user_id);
        let insert = insert
            .bind(&input.settings.title)
            .bind(&input.settings.description)
            .bind(&input.settings.public_handle);
        let insert = insert.bind(input.settings.is_public).bind(input.settings.requires_approval);
        let was_created = insert.execute(&mut *transaction).await?.rows_affected() == 1;
        let community = lock_community(&mut transaction, input.conversation_id).await?;
        lock_accounts(&mut transaction, &[actor.user_id]).await?;
        lock_actor(&mut transaction, actor, &self.accounts.settings).await?;
        let is_existing = is_replay(&mut transaction, &identity).await?;
        if !is_existing {
            if !was_created {
                return Err(AccountError::MessageConflict.into());
            }
            access::check_capacity(&mut transaction, actor.user_id).await?;
            let admit = sqlx::query(
                "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')",
            )
            .bind(community.id)
            .bind(actor.user_id);
            admit.execute(&mut *transaction).await?;
            changes::append(
                &mut transaction,
                ChangeGroup {
                    participants: &[actor.user_id],
                    conversation_id: community.id,
                    message_id: None,
                },
            )
            .await?;
            remember(&mut transaction, &identity).await?;
        }
        let receipt = receipt(&mut transaction, &identity).await?;
        transaction.commit().await?;
        Ok(receipt)
    }

    /// Apply a stable community action under the same aggregate lock as message publication.
    pub async fn community_command(
        &self,
        actor: Actor,
        input: CommunityCommand,
    ) -> Result<CommandReceipt, AccountError> {
        for attempt in 0..TRANSACTION_ATTEMPTS {
            match self.accept_community_command(&actor, &input).await {
                Ok(receipt) => return Ok(receipt),
                Err(error) if error.is_retryable() && attempt + 1 < TRANSACTION_ATTEMPTS => {
                    continue;
                }
                Err(error) => return Err(error.into_public()),
            }
        }
        Err(AccountError::Unavailable)
    }

    async fn accept_community_command(
        &self,
        actor: &Actor,
        input: &CommunityCommand,
    ) -> Result<CommandReceipt, AcceptanceError> {
        let hash = payload_hash(input)?;
        let identity = OperationIdentity {
            actor_id: actor.user_id,
            operation_id: input.operation_id,
            conversation_id: input.conversation_id,
            hash: &hash,
        };
        let mut transaction = self.accounts.pool.begin().await?;
        let community = lock_community(&mut transaction, input.conversation_id).await?;
        let mut affected = recipients(&mut transaction, community.id).await?;
        affected.push(actor.user_id);
        affected.extend(input.action.target_user());
        affected.sort();
        affected.dedup();
        // Include both removed members and joining targets before any mutation or feed allocation.
        lock_accounts(&mut transaction, &affected).await?;
        lock_actor(&mut transaction, actor, &self.accounts.settings).await?;
        if !is_replay(&mut transaction, &identity).await? {
            if community.deleted_at.is_some() {
                return Err(AccountError::NotFound.into());
            }
            let context = CommunityContext {
                actor,
                command: input,
                community: &community,
            };
            match &input.action {
                CommunityAction::Settings {
                    settings,
                    ..
                } => {
                    update_settings(&mut transaction, &context, settings.clone()).await?;
                }
                CommunityAction::Avatar {
                    ..
                } => update_avatar(&mut transaction, &context).await?,
                CommunityAction::Join {
                    ..
                }
                | CommunityAction::Invite {
                    ..
                }
                | CommunityAction::RevokeInvite {
                    ..
                }
                | CommunityAction::Approve {
                    ..
                }
                | CommunityAction::Reject {
                    ..
                } => {
                    invitations::apply(&mut transaction, &context).await?;
                }
                _ => membership::apply(&mut transaction, &context).await?,
            }
            let bump = sqlx::query("UPDATE conversations SET version = version + 1 WHERE id = $1")
                .bind(community.id);
            bump.execute(&mut *transaction).await?;
            changes::append(
                &mut transaction,
                ChangeGroup {
                    participants: &affected,
                    conversation_id: community.id,
                    message_id: None,
                },
            )
            .await?;
            remember(&mut transaction, &identity).await?;
        }
        let receipt = receipt(&mut transaction, &identity).await?;
        transaction.commit().await?;
        Ok(receipt)
    }
}
