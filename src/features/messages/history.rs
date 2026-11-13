use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, Postgres, QueryBuilder};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use super::{
    CanonicalMessage, MessageService, acceptance::MESSAGE_SELECT, projection, search::MessageKind,
};
use crate::features::{
    accounts::{AccountError, Actor},
    conversations::{self, ConversationView},
};

const DEFAULT_PAGE_SIZE: u16 = 50;
const MAX_PAGE_SIZE: u16 = 100;
const ANCHOR_SELECT: &str = "SELECT message.id, message.sequence FROM messages message";

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
    /// Center on the first visible incoming unread message, or return the latest page.
    pub unread: Option<bool>,
    pub pinned: Option<bool>,
    pub kind: Option<MessageKind>,
    pub date_at: Option<DateTime<Utc>>,
    pub date_from: Option<DateTime<Utc>>,
    pub date_to: Option<DateTime<Utc>>,
}

#[derive(Serialize, ToSchema)]
pub struct HistoryPage {
    pub messages: Vec<CanonicalMessage>,
    pub preceding_message: Option<CanonicalMessage>,
    pub has_older: bool,
    pub has_newer: bool,
    pub observation_cursor: String,
    pub generation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_id: Option<Uuid>,
}

#[derive(Clone, Copy, sqlx::FromRow)]
struct HistoryAnchor {
    id: Uuid,
    sequence: i64,
}

struct HistoryScope<'a> {
    user_id: Uuid,
    query: &'a HistoryQuery,
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

impl HistoryQuery {
    fn validate(&self) -> Result<(), AccountError> {
        let has_page_edge = self.before.is_some() || self.after.is_some();
        #[rustfmt::skip]
        let anchors = [
            self.around.is_some(),
            self.date_at.is_some(),
            self.unread == Some(true),
        ];
        let anchor_count = anchors.into_iter().filter(|is_enabled| *is_enabled).count();
        if self.before.is_some() && self.after.is_some() {
            return Err(AccountError::Validation("choose either before or after"));
        }
        if anchor_count > 0 && has_page_edge {
            return Err(AccountError::Validation("an anchor cannot be combined with a page edge"));
        }
        if anchor_count > 1 {
            return Err(AccountError::Validation("choose a single history anchor"));
        }
        if let (Some(from), Some(to)) = (self.date_from, self.date_to)
            && from >= to
        {
            return Err(AccountError::Validation("history date range is empty or inverted"));
        }
        Ok(())
    }
}

impl HistoryScope<'_> {
    fn statement(&self, select: &str) -> QueryBuilder<Postgres> {
        let mut statement = QueryBuilder::new(select);
        statement.push(" WHERE message.conversation_id = ").push_bind(self.query.conversation_id);
        projection::restrict_visible(&mut statement, self.user_id);

        // The same scope defines anchors, page contents, and both pagination edges.
        if self.query.pinned == Some(true) {
            statement.push(" AND message.is_pinned");
        }
        if let Some(kind) = self.query.kind {
            kind.restrict(&mut statement);
        }
        if let Some(date_from) = self.query.date_from {
            statement.push(" AND message.created_at >= ").push_bind(date_from);
        }
        if let Some(date_to) = self.query.date_to {
            statement.push(" AND message.created_at < ").push_bind(date_to);
        }

        statement
    }

    fn page_statement(
        &self,
        anchor: Option<HistoryAnchor>,
        limit: i64,
    ) -> Result<QueryBuilder<Postgres>, AccountError> {
        let mut statement = self.statement(MESSAGE_SELECT);
        if let Some(before) = &self.query.before {
            statement.push(" AND message.sequence < ").push_bind(parse_sequence(before)?);
        }
        let after = if let Some(anchor) = anchor {
            Some(anchor.sequence.saturating_sub(limit / 2 + 1))
        } else {
            self.query.after.as_deref().map(parse_sequence).transpose()?
        };
        if let Some(after) = after {
            statement.push(" AND message.sequence > ").push_bind(after);
            statement.push(" ORDER BY message.sequence ASC LIMIT ");
        } else {
            statement.push(" ORDER BY message.sequence DESC LIMIT ");
        }
        statement.push_bind(limit);

        Ok(statement)
    }

    async fn anchor(
        &self,
        connection: &mut PgConnection,
        conversation: &ConversationView,
    ) -> Result<Option<HistoryAnchor>, AccountError> {
        if self.query.unread == Some(true) {
            return self.first_unread(connection, conversation).await;
        }

        if let Some(target_id) = self.query.around {
            let mut statement = self.statement(ANCHOR_SELECT);
            statement.push(" AND message.id = ").push_bind(target_id);
            let target = statement.build_query_as().fetch_optional(connection).await?;
            return target.map(Some).ok_or(AccountError::NotFound);
        }

        let Some(date_at) = self.query.date_at else {
            return Ok(None);
        };
        let mut after = self.statement(ANCHOR_SELECT);
        after.push(" AND message.created_at >= ").push_bind(date_at);
        after.push(" ORDER BY message.created_at ASC, message.id ASC LIMIT 1");
        let after = after.build_query_as().fetch_optional(&mut *connection).await?;
        if after.is_some() {
            return Ok(after);
        }

        // An empty future interval still has a meaningful latest authorized message.
        let mut before = self.statement(ANCHOR_SELECT);
        before.push(" AND message.created_at < ").push_bind(date_at);
        before.push(" ORDER BY message.created_at DESC, message.id DESC LIMIT 1");
        Ok(before.build_query_as().fetch_optional(connection).await?)
    }

    async fn first_unread(
        &self,
        connection: &mut PgConnection,
        conversation: &ConversationView,
    ) -> Result<Option<HistoryAnchor>, AccountError> {
        if conversation.kind == "saved" || conversation.unread_count == "0" {
            return Ok(None);
        }

        // Match the directory's unread definition in the same authorized history snapshot.
        let mut statement = self.statement(ANCHOR_SELECT);
        let read_through = parse_sequence(&conversation.read_through)?;
        statement.push(" AND message.sequence > ").push_bind(read_through);
        statement.push(" AND message.author_id <> ").push_bind(self.user_id);
        statement.push(" AND message.service_kind IS NULL ORDER BY message.sequence ASC LIMIT 1");
        Ok(statement.build_query_as().fetch_optional(connection).await?)
    }

    async fn preceding(
        &self,
        connection: &mut PgConnection,
        first: &CanonicalMessage,
    ) -> Result<Option<CanonicalMessage>, AccountError> {
        let mut statement = self.statement(MESSAGE_SELECT);
        statement.push(" AND message.sequence < ").push_bind(parse_sequence(&first.sequence)?);
        statement.push(" ORDER BY message.sequence DESC LIMIT 1");

        Ok(statement.build_query_as().fetch_optional(connection).await?)
    }

    async fn has_newer(
        &self,
        connection: &mut PgConnection,
        messages: &[CanonicalMessage],
    ) -> Result<bool, AccountError> {
        let last_sequence = messages.last().map(|last| last.sequence.as_str());
        let after = last_sequence.or(self.query.after.as_deref()).unwrap_or("0");
        let mut statement = self.statement("SELECT EXISTS (SELECT 1 FROM messages message");
        statement.push(" AND message.sequence > ").push_bind(parse_sequence(after)?);
        statement.push(")");

        Ok(statement.build_query_scalar().fetch_one(connection).await?)
    }
}

impl MessageService {
    /// Read a bounded sequence window from a conversation owned by the requesting account.
    pub async fn history(
        &self,
        actor: Actor,
        query: HistoryQuery,
    ) -> Result<HistoryPage, AccountError> {
        query.validate()?;
        let limit = page_size(query.limit)?;
        let mut transaction = self.snapshot(&actor).await?;
        let conversation =
            conversations::view(&mut transaction, actor.user_id, query.conversation_id).await?;
        let history = HistoryScope {
            user_id: actor.user_id,
            query: &query,
        };
        let anchor = history.anchor(&mut transaction, &conversation).await?;
        let mut statement = history.page_statement(anchor, limit)?;
        let page = statement.build_query_as();
        let mut messages: Vec<CanonicalMessage> = page.fetch_all(&mut *transaction).await?;
        if anchor.is_none() && query.after.is_none() {
            messages.reverse();
        }
        for message in &mut messages {
            projection::personalize(&mut transaction, actor.user_id, message).await?;
        }
        let mut preceding_message = if let Some(first) = messages.first() {
            history.preceding(&mut transaction, first).await?
        } else {
            None
        };
        if let Some(message) = &mut preceding_message {
            projection::personalize(&mut transaction, actor.user_id, message).await?;
        }
        let has_older = preceding_message.is_some();
        let has_newer = history.has_newer(&mut transaction, &messages).await?;
        let scope =
            crate::features::sync::cursor::CursorScope::read(&mut transaction, actor.user_id)
                .await?;
        transaction.commit().await?;

        Ok(HistoryPage {
            messages,
            preceding_message,
            has_older,
            has_newer,
            observation_cursor: scope.encode(scope.position),
            generation: conversation.generation,
            anchor_id: anchor.map(|entry| entry.id),
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
