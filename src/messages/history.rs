use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, Postgres, QueryBuilder};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use super::{CanonicalMessage, MessageService, acceptance::MESSAGE_SELECT};
use crate::{
    accounts::{AccountError, Actor},
    conversations,
};

const DEFAULT_PAGE_SIZE: u16 = 50;
const MAX_PAGE_SIZE: u16 = 100;

#[derive(Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct HistoryQuery {
    #[serde(skip)]
    #[param(ignore)]
    pub conversation_id: Uuid,
    pub before: Option<String>,
    pub after: Option<String>,
    pub limit: Option<u16>,
}

#[derive(Serialize, ToSchema)]
pub struct HistoryPage {
    pub messages: Vec<CanonicalMessage>,
    pub preceding_message: Option<CanonicalMessage>,
    pub has_older: bool,
    pub has_newer: bool,
}

/// Validate a decimal counter without rounding it through a browser floating-point number.
pub(crate) fn parse_sequence(value: &str) -> Result<i64, AccountError> {
    if value.is_empty() || !value.bytes().all(|character| character.is_ascii_digit()) {
        return Err(AccountError::Validation("sequence must be an unsigned decimal string"));
    }
    value.parse().map_err(|_| AccountError::Validation("sequence is outside the supported range"))
}

/// Apply a shared upper bound to history pages and complete synchronization groups.
pub(crate) fn page_size(limit: Option<u16>) -> Result<i64, AccountError> {
    let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE);
    if !(1..=MAX_PAGE_SIZE).contains(&limit) {
        return Err(AccountError::Validation("page size must be between 1 and 100"));
    }

    Ok(i64::from(limit))
}

fn history_statement(query: &HistoryQuery) -> Result<QueryBuilder<Postgres>, AccountError> {
    if query.before.is_some() && query.after.is_some() {
        return Err(AccountError::Validation("choose either before or after"));
    }
    let mut statement = QueryBuilder::new(MESSAGE_SELECT);
    statement.push(" WHERE message.conversation_id = ").push_bind(query.conversation_id);
    if let Some(before) = &query.before {
        statement.push(" AND message.sequence < ").push_bind(parse_sequence(before)?);
    }
    if let Some(after) = &query.after {
        statement.push(" AND message.sequence > ").push_bind(parse_sequence(after)?);
    }
    if query.after.is_some() {
        statement.push(" ORDER BY message.sequence ASC LIMIT ");
    } else {
        statement.push(" ORDER BY message.sequence DESC LIMIT ");
    }
    statement.push_bind(page_size(query.limit)?);

    Ok(statement)
}

/// Fetch the preceding authorized message to preserve sender grouping across a remote page edge.
async fn preceding(
    connection: &mut PgConnection,
    conversation_id: Uuid,
    first_sequence: i64,
) -> Result<Option<CanonicalMessage>, AccountError> {
    let mut statement = QueryBuilder::new(MESSAGE_SELECT);
    statement.push(" WHERE message.conversation_id = ").push_bind(conversation_id);
    statement.push(" AND message.sequence < ").push_bind(first_sequence);
    statement.push(" ORDER BY message.sequence DESC LIMIT 1");

    Ok(statement.build_query_as().fetch_optional(connection).await?)
}

impl MessageService {
    /// Read a bounded sequence window from a conversation owned by the requesting account.
    pub async fn history(
        &self,
        actor: Actor,
        query: HistoryQuery,
    ) -> Result<HistoryPage, AccountError> {
        let mut statement = history_statement(&query)?;
        let mut transaction = self.snapshot(&actor).await?;
        let conversation =
            conversations::view(&mut transaction, actor.user_id, query.conversation_id).await?;
        let mut messages: Vec<CanonicalMessage> =
            statement.build_query_as().fetch_all(&mut *transaction).await?;
        if query.after.is_none() {
            messages.reverse();
        }
        let preceding_message = if let Some(first) = messages.first() {
            preceding(&mut transaction, query.conversation_id, parse_sequence(&first.sequence)?)
                .await?
        } else {
            None
        };
        let has_older = preceding_message.is_some();
        let has_newer = match messages.last() {
            Some(last) => {
                parse_sequence(&last.sequence)? < parse_sequence(&conversation.last_sequence)?
            }
            None => query.before.is_some() && conversation.last_sequence != "0",
        };
        transaction.commit().await?;

        Ok(HistoryPage {
            messages,
            preceding_message,
            has_older,
            has_newer,
        })
    }

    /// Read a single currently authorized message, hiding unknown and foreign IDs equally.
    pub async fn message(
        &self,
        actor: Actor,
        message_id: Uuid,
    ) -> Result<CanonicalMessage, AccountError> {
        let mut transaction = self.snapshot(&actor).await?;
        let receipt =
            super::acceptance::receipt(&mut transaction, actor.user_id, message_id).await?;
        transaction.commit().await?;

        Ok(receipt.message)
    }
}
