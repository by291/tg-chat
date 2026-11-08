use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, Postgres, QueryBuilder};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use super::{CanonicalMessage, MessageService, acceptance::MESSAGE_SELECT, projection};
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
    pub around: Option<Uuid>,
}

#[derive(Serialize, ToSchema)]
pub struct HistoryPage {
    pub messages: Vec<CanonicalMessage>,
    pub preceding_message: Option<CanonicalMessage>,
    pub has_older: bool,
    pub has_newer: bool,
    pub observation_cursor: String,
    pub generation: String,
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

fn history_statement(
    query: &HistoryQuery,
    user_id: Uuid,
) -> Result<QueryBuilder<Postgres>, AccountError> {
    if query.before.is_some() && query.after.is_some() {
        return Err(AccountError::Validation("choose either before or after"));
    }
    let mut statement = QueryBuilder::new(MESSAGE_SELECT);
    statement.push(" WHERE message.conversation_id = ").push_bind(query.conversation_id);
    projection::restrict_visible(&mut statement, user_id);
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

struct PrecedingQuery {
    conversation_id: Uuid,
    user_id: Uuid,
    first_sequence: i64,
}

/// Fetch the preceding authorized message to preserve sender grouping across a remote page edge.
async fn preceding(
    connection: &mut PgConnection,
    query: PrecedingQuery,
) -> Result<Option<CanonicalMessage>, AccountError> {
    let mut statement = QueryBuilder::new(MESSAGE_SELECT);
    statement.push(" WHERE message.conversation_id = ").push_bind(query.conversation_id);
    projection::restrict_visible(&mut statement, query.user_id);
    statement.push(" AND message.sequence < ").push_bind(query.first_sequence);
    statement.push(" ORDER BY message.sequence DESC LIMIT 1");

    Ok(statement.build_query_as().fetch_optional(connection).await?)
}

impl MessageService {
    /// Read a bounded sequence window from a conversation owned by the requesting account.
    pub async fn history(
        &self,
        actor: Actor,
        mut query: HistoryQuery,
    ) -> Result<HistoryPage, AccountError> {
        let mut transaction = self.snapshot(&actor).await?;
        let conversation =
            conversations::view(&mut transaction, actor.user_id, query.conversation_id).await?;
        if let Some(target_id) = query.around {
            if query.before.is_some() || query.after.is_some() {
                return Err(AccountError::Validation("around cannot be combined with a page edge"));
            }
            let mut target = sqlx::QueryBuilder::new(
                "SELECT message.sequence FROM messages message WHERE message.id = ",
            );
            target.push_bind(target_id);
            target.push(" AND message.conversation_id = ").push_bind(query.conversation_id);
            projection::restrict_visible(&mut target, actor.user_id);
            let sequence: i64 = target
                .build_query_scalar()
                .fetch_optional(&mut *transaction)
                .await?
                .ok_or(AccountError::NotFound)?;
            let radius = page_size(query.limit)? / 2;
            query.after = Some(sequence.saturating_sub(radius + 1).to_string());
        }
        let mut statement = history_statement(&query, actor.user_id)?;
        let mut messages: Vec<CanonicalMessage> =
            statement.build_query_as().fetch_all(&mut *transaction).await?;
        if query.after.is_none() {
            messages.reverse();
        }
        for message in &mut messages {
            projection::personalize(&mut transaction, actor.user_id, message).await?;
        }
        let mut preceding_message = if let Some(first) = messages.first() {
            preceding(
                &mut transaction,
                PrecedingQuery {
                    conversation_id: query.conversation_id,
                    user_id: actor.user_id,
                    first_sequence: parse_sequence(&first.sequence)?,
                },
            )
            .await?
        } else {
            None
        };
        if let Some(message) = &mut preceding_message {
            projection::personalize(&mut transaction, actor.user_id, message).await?;
        }
        let has_older = preceding_message.is_some();
        let last_sequence = messages.last().map(|message| message.sequence.as_str()).unwrap_or("0");
        let mut newer = sqlx::QueryBuilder::new(
            "SELECT EXISTS (SELECT 1 FROM messages message WHERE message.conversation_id = ",
        );
        newer.push_bind(query.conversation_id);
        newer.push(" AND message.sequence > ").push_bind(parse_sequence(last_sequence)?);
        projection::restrict_visible(&mut newer, actor.user_id);
        newer.push(")");
        let has_newer = newer.build_query_scalar().fetch_one(&mut *transaction).await?;
        let scope = crate::sync::cursor::CursorScope::read(&mut transaction, actor.user_id).await?;
        transaction.commit().await?;

        Ok(HistoryPage {
            messages,
            preceding_message,
            has_older,
            has_newer,
            observation_cursor: scope.encode(scope.position),
            generation: conversation.generation,
        })
    }

    /// Read a single currently authorized message, hiding unknown and foreign IDs equally.
    pub async fn message(
        &self,
        actor: Actor,
        message_id: Uuid,
    ) -> Result<CanonicalMessage, AccountError> {
        let mut transaction = self.snapshot(&actor).await?;
        let mut statement = sqlx::QueryBuilder::new(MESSAGE_SELECT);
        statement.push(" WHERE message.id = ").push_bind(message_id);
        projection::restrict_visible(&mut statement, actor.user_id);
        let mut message = statement
            .build_query_as::<CanonicalMessage>()
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or(AccountError::NotFound)?;
        projection::personalize(&mut transaction, actor.user_id, &mut message).await?;
        transaction.commit().await?;

        Ok(message)
    }
}
