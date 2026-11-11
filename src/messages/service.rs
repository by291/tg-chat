use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Postgres, Transaction};

use super::{Destination, SendMessage, SendReceipt, acceptance, bodies, content};
use crate::{
    accounts::{AccountError, AccountService, Actor, sessions::lock_actor},
    conversations::{self, ConversationView, access},
    media::references,
    sync::changes::{self, ChangeGroup},
};

const TRANSACTION_ATTEMPTS: usize = 3;

#[derive(Clone)]
pub struct MessageService {
    pub(crate) accounts: AccountService,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum AcceptanceError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Business(#[from] AccountError),
}

impl AcceptanceError {
    pub(crate) fn is_retryable(&self) -> bool {
        let Self::Database(error) = self else {
            return false;
        };
        let Some(database_error) = error.as_database_error() else {
            return false;
        };

        matches!(database_error.code().as_deref(), Some("40001" | "40P01"))
    }

    pub(crate) fn into_public(self) -> AccountError {
        match self {
            Self::Business(error) => error,
            Self::Database(error) => {
                let is_conflict = error
                    .as_database_error()
                    .is_some_and(|diagnostic| diagnostic.is_unique_violation());
                if is_conflict {
                    return AccountError::MessageConflict;
                }
                AccountError::Unavailable
            }
        }
    }
}

impl MessageService {
    /// Share the account boundary and PostgreSQL pool with message transactions.
    pub fn new(accounts: AccountService) -> Self {
        Self {
            accounts,
        }
    }

    /// Accept one canonical message atomically or reconcile its durable operation identity.
    pub async fn send(
        &self,
        actor: Actor,
        mut input: SendMessage,
    ) -> Result<SendReceipt, AccountError> {
        if input.body.is_some() && !input.attachments.is_empty() {
            return Err(AccountError::Validation("typed bodies cannot include media files"));
        }
        references::validate_attachments(&input.attachments)?;
        input.body = input.body.map(bodies::normalize).transpose()?;

        let is_text_only = input.attachments.is_empty() && input.body.is_none();
        input.content = if is_text_only {
            content::validate_content(input.content)?
        } else {
            content::validate_caption(input.content)?
        };

        // Omitting an absent body preserves the exact fingerprint of pre-existing requests.
        let serialized = serde_json::to_vec(&input).map_err(|_| AccountError::Unavailable)?;
        let payload_hash = Sha256::digest(serialized).to_vec();

        for attempt in 0..TRANSACTION_ATTEMPTS {
            let result = self.accept(&actor, &input, &payload_hash).await;
            match result {
                Ok(receipt) => return Ok(receipt),
                Err(error) if error.is_retryable() && attempt + 1 < TRANSACTION_ATTEMPTS => {
                    continue;
                }
                Err(error) => return Err(error.into_public()),
            }
        }

        Err(AccountError::Unavailable)
    }

    /// Create the account's reserved private conversation without consuming directory capacity.
    pub async fn ensure_saved(&self, actor: Actor) -> Result<ConversationView, AccountError> {
        for attempt in 0..TRANSACTION_ATTEMPTS {
            let result = self.create_saved(&actor).await;
            match result {
                Ok(conversation) => return Ok(conversation),
                Err(error) if error.is_retryable() && attempt + 1 < TRANSACTION_ATTEMPTS => {
                    continue;
                }
                Err(error) => return Err(error.into_public()),
            }
        }

        Err(AccountError::Unavailable)
    }

    async fn accept(
        &self,
        actor: &Actor,
        input: &SendMessage,
        payload_hash: &[u8],
    ) -> Result<SendReceipt, AcceptanceError> {
        let mut transaction = self.accounts.pool.begin().await?;
        let conversation =
            access::lock_conversation(&mut transaction, actor, &input.destination).await?;
        access::lock_participants(&mut transaction, &conversation).await?;
        lock_actor(&mut transaction, actor, &self.accounts.settings).await?;

        // Replay precedes current recipient policy: a later block must not hide an accepted send.
        if let Some(receipt) = acceptance::reconcile(
            &mut transaction,
            acceptance::IdentityCheck {
                actor,
                input,
                payload_hash,
            },
        )
        .await?
        {
            transaction.commit().await?;
            return Ok(receipt);
        }

        let is_command_identity: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM command_receipts WHERE actor_id = $1 AND operation_id = $2)",
        ).bind(actor.user_id).bind(input.operation_id).fetch_one(&mut *transaction).await?;
        let is_forward_identity = super::forwarding::operation_exists(
            &mut transaction,
            actor.user_id,
            input.operation_id,
        )
        .await?;
        if is_command_identity || is_forward_identity {
            return Err(AccountError::MessageConflict.into());
        }
        access::authorize_send(&mut transaction, actor, &conversation).await?;
        // Check the directory only for new sends so a later suspension cannot break replay.
        let body = if let Some(body) = &input.body {
            Some(bodies::store(&mut transaction, actor.user_id, body).await?)
        } else {
            None
        };

        access::admit_members(&mut transaction, &conversation).await?;
        acceptance::insert(
            &mut transaction,
            acceptance::NewMessage {
                actor,
                input,
                payload_hash,
                conversation: &conversation,
                body: body.as_ref(),
                forward: None,
            },
        )
        .await?;
        let receipt =
            acceptance::receipt(&mut transaction, actor.user_id, input.message_id).await?;
        transaction.commit().await?;

        Ok(receipt)
    }

    async fn create_saved(&self, actor: &Actor) -> Result<ConversationView, AcceptanceError> {
        let mut transaction = self.accounts.pool.begin().await?;
        let conversation =
            access::lock_conversation(&mut transaction, actor, &Destination::Saved).await?;
        access::lock_participants(&mut transaction, &conversation).await?;
        lock_actor(&mut transaction, actor, &self.accounts.settings).await?;
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = $1)",
        )
        .bind(conversation.id)
        .fetch_one(&mut *transaction)
        .await?;
        access::admit_members(&mut transaction, &conversation).await?;
        let participants = access::participants(&mut transaction, &conversation).await?;
        if !exists {
            changes::append(
                &mut transaction,
                ChangeGroup {
                    participants: &participants,
                    conversation_id: conversation.id,
                    message_id: None,
                },
            )
            .await?;
        }
        let view = conversations::view(&mut transaction, actor.user_id, conversation.id).await?;
        transaction.commit().await?;

        Ok(view)
    }
    /// Open a consistent authorized read snapshot without taking write locks on the account.
    pub(crate) async fn snapshot(
        &self,
        actor: &Actor,
    ) -> Result<Transaction<'_, Postgres>, AccountError> {
        let mut transaction = self.accounts.pool.begin().await?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *transaction)
            .await?;
        verify_actor(&mut transaction, actor, self.accounts.settings.idle_days).await?;

        Ok(transaction)
    }
}

/// Recheck revocation inside the same snapshot that supplies private message projections.
pub(crate) async fn verify_actor(
    connection: &mut PgConnection,
    actor: &Actor,
    idle_days: i64,
) -> Result<(), AccountError> {
    let query = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.id = $1 AND users.id = $2 AND NOT users.is_suspended
           AND sessions.revoked_at IS NULL AND sessions.expires_at > now()
           AND sessions.last_seen_at > now() - ($3::bigint * interval '1 day'))",
    )
    .bind(actor.session_id)
    .bind(actor.user_id)
    .bind(idle_days);
    if !query.fetch_one(connection).await? {
        return Err(AccountError::Unauthenticated);
    }

    Ok(())
}
