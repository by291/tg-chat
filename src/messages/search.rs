use std::time::Duration;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Days, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Postgres, QueryBuilder};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use super::{CanonicalMessage, MessageService, acceptance::MESSAGE_SELECT, history, projection};
use crate::{
    accounts::{AccountError, Actor},
    conversations,
    sync::cursor::CursorScope,
};

const DEFAULT_PAGE_SIZE: u16 = 30;
const MAX_QUERY_BYTES: usize = 4_096;
const MAX_CURSOR_BYTES: usize = 512;
const MIN_GLOBAL_QUERY_SCALARS: usize = 3;
const SHORT_SEARCH_WINDOW: Days = Days::new(30);
const CANDIDATE_BUDGET: i64 = 5_000;
const SEARCH_TIMEOUT: Duration = Duration::from_secs(2);
const INVALID_CURSOR: AccountError = AccountError::Validation("invalid search cursor");

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind {
    Photo,
    Video,
    PhotoVideo,
    File,
    Voice,
    Link,
    Text,
    Sticker,
    Contact,
    Poll,
    Checklist,
    Service,
}

#[derive(Clone, Default, Deserialize, IntoParams, Serialize)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct SearchQuery {
    #[serde(default)]
    pub query: String,
    pub conversation_id: Option<Uuid>,
    pub sender_id: Option<Uuid>,
    pub date_from: Option<DateTime<Utc>>,
    pub date_to: Option<DateTime<Utc>>,
    pub kind: Option<MessageKind>,
    pub cursor: Option<String>,
    pub limit: Option<u16>,
}

#[derive(Serialize, ToSchema)]
pub struct SearchPage {
    pub hits: Vec<CanonicalMessage>,
    pub date_from: Option<DateTime<Utc>>,
    pub date_to: Option<DateTime<Utc>>,
    pub observation_cursor: String,
    pub next_cursor: Option<String>,
    pub is_truncated: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SearchCursor {
    deployment_id: Uuid,
    user_id: Uuid,
    fingerprint: String,
    as_of: DateTime<Utc>,
    created_at: DateTime<Utc>,
    message_id: Uuid,
}

struct SearchCriteria {
    query: SearchQuery,
    fingerprint: String,
    limit: i64,
    is_short: bool,
    cursor: Option<SearchCursor>,
}

struct SearchWindow {
    as_of: DateTime<Utc>,
    date_from: Option<DateTime<Utc>>,
    date_to: Option<DateTime<Utc>>,
}

struct HitQuery<'a> {
    criteria: &'a SearchCriteria,
    window: &'a SearchWindow,
    user_id: Uuid,
    candidates: Option<Vec<Uuid>>,
}

impl MessageKind {
    fn supports_browsing(self) -> bool {
        matches!(
            self,
            Self::Photo | Self::Video | Self::PhotoVideo | Self::File | Self::Voice | Self::Link
        )
    }

    /// Restrict messages to a canonical attachment, structured body, or link category.
    pub(crate) fn restrict(self, statement: &mut QueryBuilder<Postgres>) {
        match self {
            Self::Photo => restrict_attachment(statement, &["image"]),
            Self::Video => restrict_attachment(statement, &["video"]),
            Self::PhotoVideo => restrict_attachment(statement, &["image", "video"]),
            Self::File => restrict_attachment(statement, &["document"]),
            Self::Voice => restrict_attachment(statement, &["voice"]),
            Self::Link => {
                // A link can be explicit rich markup even if the visible label is plain text.
                statement.push(
                    " AND (message.content->>'rich_text' ~ '<a[[:space:]][^>]*href='
                      OR message.content->>'text' ~* 'https?://[^[:space:]<>]+')",
                );
            }
            Self::Text => {
                statement.push(
                    " AND message.body IS NULL AND message.service_kind IS NULL
                      AND message.content->>'text' <> ''",
                );
            }
            Self::Sticker => restrict_body(statement, &["sticker"]),
            Self::Contact => restrict_body(statement, &["contact"]),
            Self::Poll => restrict_body(statement, &["poll", "poll_snapshot"]),
            Self::Checklist => restrict_body(statement, &["checklist", "checklist_snapshot"]),
            Self::Service => {
                statement.push(" AND message.service_kind IS NOT NULL");
            }
        }
    }
}

fn restrict_attachment(statement: &mut QueryBuilder<Postgres>, purposes: &[&'static str]) {
    statement.push(
        " AND EXISTS (SELECT 1 FROM media_message_references reference
          JOIN media_files file ON file.id = reference.file_id
          JOIN media_uploads upload ON upload.id = file.upload_id
          WHERE reference.message_id = message.id
            AND file.deleted_at IS NULL AND upload.purpose = ANY(",
    );
    statement.push_bind(purposes.to_vec());
    statement.push("::media_upload_purpose[]))");
}

fn restrict_body(statement: &mut QueryBuilder<Postgres>, kinds: &[&'static str]) {
    statement.push(" AND message.body->>'kind' = ANY(");
    statement.push_bind(kinds.to_vec());
    statement.push(")");
}

impl SearchCursor {
    fn decode(encoded: &str) -> Result<Self, AccountError> {
        if encoded.len() > MAX_CURSOR_BYTES {
            return Err(INVALID_CURSOR);
        }
        let bytes = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| INVALID_CURSOR)?;
        serde_json::from_slice(&bytes).map_err(|_| INVALID_CURSOR)
    }

    fn encode(&self) -> String {
        let bytes = serde_json::to_vec(self).expect("search cursor fields are serializable");
        URL_SAFE_NO_PAD.encode(bytes)
    }
}

impl SearchCriteria {
    fn new(mut query: SearchQuery) -> Result<Self, AccountError> {
        let limit = history::page_size(Some(query.limit.take().unwrap_or(DEFAULT_PAGE_SIZE)))?;
        if query.query.len() > MAX_QUERY_BYTES || query.query.contains('\0') {
            return Err(AccountError::Validation("invalid search text"));
        }
        let query_length = query.query.chars().count();
        let is_short = (1..MIN_GLOBAL_QUERY_SCALARS).contains(&query_length);
        if is_short && query.conversation_id.is_none() {
            return Err(AccountError::Validation(
                "global search requires at least three characters",
            ));
        }
        let can_browse = query.conversation_id.is_some()
            && query.kind.is_some_and(MessageKind::supports_browsing);
        if query_length == 0 && !can_browse {
            return Err(AccountError::Validation("search requires text or a chat media filter"));
        }
        if let (Some(from), Some(to)) = (query.date_from, query.date_to)
            && from >= to
        {
            return Err(AccountError::Validation("search date range is empty or inverted"));
        }

        // Hash canonical request fields to bind pagination without embedding search text.
        let cursor =
            query.cursor.take().map(|encoded| SearchCursor::decode(&encoded)).transpose()?;
        let encoded = serde_json::to_vec(&query).expect("search query fields are serializable");
        let fingerprint = hex::encode(Sha256::digest(encoded));

        Ok(Self {
            query,
            fingerprint,
            limit,
            is_short,
            cursor,
        })
    }

    fn window(
        &self,
        scope: &CursorScope,
        now: DateTime<Utc>,
    ) -> Result<SearchWindow, AccountError> {
        let mut as_of = now;
        if let Some(cursor) = &self.cursor {
            let is_valid = cursor.deployment_id == scope.deployment_id
                && cursor.user_id == scope.user_id
                && cursor.fingerprint == self.fingerprint
                && cursor.as_of <= now
                && cursor.created_at <= cursor.as_of;
            if !is_valid {
                return Err(INVALID_CURSOR);
            }
            as_of = cursor.as_of;
        }

        let mut window = SearchWindow {
            as_of,
            date_from: self.query.date_from,
            date_to: self.query.date_to,
        };
        if self.is_short {
            // Anchor wide or open ranges to their latest instant so the newest results come first.
            let to = window.date_to.unwrap_or(as_of).min(as_of);
            let floor = to
                .checked_sub_days(SHORT_SEARCH_WINDOW)
                .ok_or(AccountError::Validation("search date is outside the supported range"))?;
            window.date_from = Some(window.date_from.unwrap_or(floor).clamp(floor, to));
            window.date_to = Some(to);
        }
        Ok(window)
    }
}

impl SearchWindow {
    fn restrict(&self, statement: &mut QueryBuilder<Postgres>) {
        statement.push(" AND message.created_at <= ").push_bind(self.as_of);
        if let Some(date_from) = self.date_from {
            statement.push(" AND message.created_at >= ").push_bind(date_from);
        }
        if let Some(date_to) = self.date_to {
            statement.push(" AND message.created_at < ").push_bind(date_to);
        }
    }
}

async fn candidate_ids(
    connection: &mut PgConnection,
    window: &SearchWindow,
    member: (Uuid, Uuid),
) -> Result<Vec<Uuid>, AccountError> {
    // Reuse the same newest candidate prefix across pages so paging cannot extend the budget.
    let (conversation_id, user_id) = member;
    let mut statement = QueryBuilder::new(
        "SELECT message.id FROM messages message
         JOIN conversation_members member ON member.conversation_id = message.conversation_id
         WHERE message.deleted_at IS NULL AND message.sequence > member.clear_through
           AND member.user_id = ",
    );
    statement.push_bind(user_id);
    statement.push(" AND message.conversation_id = ").push_bind(conversation_id);
    window.restrict(&mut statement);
    statement.push(" ORDER BY message.created_at DESC, message.id DESC LIMIT ");
    statement.push_bind(CANDIDATE_BUDGET + 1);
    Ok(statement.build_query_scalar().fetch_all(connection).await?)
}

fn literal_pattern(term: &str) -> String {
    let mut pattern = String::with_capacity(term.len() + 2);
    pattern.push('%');
    for character in term.chars() {
        // An explicit escape marker keeps backslashes literal in bound parameters.
        if matches!(character, '!' | '%' | '_') {
            pattern.push('!');
        }
        pattern.push(character);
    }
    pattern.push('%');

    pattern
}

fn hit_statement(query: HitQuery<'_>) -> QueryBuilder<Postgres> {
    let mut statement = QueryBuilder::new("");
    if let Some(candidates) = query.candidates {
        // Materialization keeps the optimizer from testing text outside the candidate prefix.
        statement.push("WITH messages AS MATERIALIZED (SELECT * FROM messages WHERE id = ANY(");
        statement.push_bind(candidates);
        statement.push(")) ");
    }
    statement.push(MESSAGE_SELECT);
    statement.push(" WHERE TRUE");
    projection::restrict_visible(&mut statement, query.user_id);
    query.window.restrict(&mut statement);

    let criteria = query.criteria;
    if let Some(conversation_id) = criteria.query.conversation_id {
        statement.push(" AND message.conversation_id = ").push_bind(conversation_id);
    }
    if let Some(sender_id) = criteria.query.sender_id {
        statement.push(" AND message.author_id = ").push_bind(sender_id);
    }
    if let Some(kind) = criteria.query.kind {
        kind.restrict(&mut statement);
    }
    if !criteria.query.query.is_empty() {
        statement.push(" AND normalize(message.content->>'text', NFC) ILIKE normalize(");
        statement.push_bind(literal_pattern(&criteria.query.query));
        statement.push(", NFC) ESCAPE '!'");
    }
    if let Some(cursor) = &criteria.cursor {
        statement.push(" AND (message.created_at, message.id) < (");
        statement.push_bind(cursor.created_at);
        statement.push(", ").push_bind(cursor.message_id);
        statement.push(")");
    }
    statement.push(" ORDER BY message.created_at DESC, message.id DESC LIMIT ");
    statement.push_bind(criteria.limit + 1);

    statement
}

impl MessageService {
    /// Search current authorized text or browse a supported media category in one conversation.
    pub async fn search(
        &self,
        actor: Actor,
        query: SearchQuery,
    ) -> Result<SearchPage, AccountError> {
        let criteria = SearchCriteria::new(query)?;
        tokio::time::timeout(SEARCH_TIMEOUT, self.search_snapshot(actor, criteria))
            .await
            .map_err(|_| AccountError::Unavailable)?
    }

    async fn search_snapshot(
        &self,
        actor: Actor,
        criteria: SearchCriteria,
    ) -> Result<SearchPage, AccountError> {
        let mut transaction = self.snapshot(&actor).await?;
        let timeout = sqlx::query("SELECT set_config('statement_timeout', $1, true)")
            .bind(SEARCH_TIMEOUT.as_millis().to_string());
        timeout.execute(&mut *transaction).await?;

        let scope = CursorScope::read(&mut transaction, actor.user_id).await?;
        let now = sqlx::query_scalar("SELECT now()").fetch_one(&mut *transaction).await?;
        let window = criteria.window(&scope, now)?;
        if let Some(conversation_id) = criteria.query.conversation_id {
            conversations::view(&mut transaction, actor.user_id, conversation_id).await?;
        }

        let (candidates, is_truncated) = if criteria.is_short {
            let conversation_id = criteria.query.conversation_id.expect("short search is scoped");
            let member = (conversation_id, actor.user_id);
            let mut candidates = candidate_ids(&mut transaction, &window, member).await?;
            let is_truncated = candidates.len() > CANDIDATE_BUDGET as usize;
            candidates.truncate(CANDIDATE_BUDGET as usize);
            (Some(candidates), is_truncated)
        } else {
            (None, false)
        };
        let mut statement = hit_statement(HitQuery {
            criteria: &criteria,
            window: &window,
            user_id: actor.user_id,
            candidates,
        });
        let query = statement.build_query_as::<CanonicalMessage>();
        let mut hits = query.fetch_all(&mut *transaction).await?;
        let has_next = hits.len() > criteria.limit as usize;
        hits.truncate(criteria.limit as usize);
        for message in &mut hits {
            projection::personalize(&mut transaction, actor.user_id, message).await?;
        }
        transaction.commit().await?;

        let next_cursor = if has_next {
            let last = hits.last().expect("a next page follows a nonempty page");
            let cursor = SearchCursor {
                deployment_id: scope.deployment_id,
                user_id: scope.user_id,
                fingerprint: criteria.fingerprint,
                as_of: window.as_of,
                created_at: last.created_at,
                message_id: last.id,
            };
            Some(cursor.encode())
        } else {
            None
        };

        Ok(SearchPage {
            hits,
            date_from: window.date_from,
            date_to: window.date_to,
            observation_cursor: scope.encode(scope.position),
            next_cursor,
            is_truncated,
        })
    }
}
