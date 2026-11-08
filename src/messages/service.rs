use sha2::{Digest, Sha256};

use super::{Destination, SendMessage, SendReceipt, acceptance, content::validate_content};
use crate::{
    accounts::{AccountError, AccountService, Actor, sessions::lock_actor},
    conversations::{self, ConversationView, access},
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
    fn is_retryable(&self) -> bool {
        let Self::Database(error) = self else {
            return false;
        };
        let Some(database_error) = error.as_database_error() else {
            return false;
        };

        matches!(database_error.code().as_deref(), Some("40001" | "40P01"))
    }

    fn into_public(self) -> AccountError {
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
        input.content = validate_content(input.content)?;
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

        access::authorize_send(&mut transaction, actor, &conversation).await?;
        access::admit_members(&mut transaction, &conversation).await?;
        acceptance::insert(
            &mut transaction,
            acceptance::NewMessage {
                actor,
                input,
                payload_hash,
                conversation: &conversation,
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
        if !exists {
            changes::append(
                &mut transaction,
                ChangeGroup {
                    participants: &conversation.participants(),
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
}
