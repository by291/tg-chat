//! Version-bound text metadata fetched through the private preview service.

use std::time::Duration;

use reqwest::{Client, Response, StatusCode, Url};
use scraper::{ElementRef, Html, Node};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection, PgPool, types::Json};
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    accounts::AccountError,
    conversations::access,
    messages::{commands::advance_interaction, content::MessageContent},
    sync::changes::{self, ChangeGroup},
};

const MAX_URL_BYTES: usize = 8192;
const MAX_CONTROL_RESPONSE_BYTES: usize = 8192;
const CONTROL_TIMEOUT: Duration = Duration::from_secs(6);
const POLL_INTERVAL: Duration = Duration::from_secs(1);
const LEASE_SECONDS: i64 = 30;
const RETRY_SECONDS: i64 = 2;
const MAX_ATTEMPTS: i32 = 3;
const MAX_SITE_NAME_CHARS: usize = 100;
const MAX_TITLE_CHARS: usize = 200;
const MAX_SUMMARY_CHARS: usize = 500;

#[rustfmt::skip]
const OPENING_PROSE_WRAPPERS: &[char] = &[
    '(',
    '[',
    '{',
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
pub struct LinkPreviewView {
    pub url: String,
    pub site_name: String,
    pub title: String,
    pub summary: String,
}

pub(crate) struct PreviewIntent<'a> {
    pub message_id: Uuid,
    pub content_version: i64,
    pub url: Option<&'a str>,
}

#[derive(Clone)]
pub struct LinkPreviews {
    pool: PgPool,
    client: Client,
    endpoint: Url,
}

#[derive(FromRow)]
struct PreviewClaim {
    message_id: Uuid,
    content_version: i64,
    target_url: String,
    lease_token: Uuid,
}

#[derive(Serialize)]
struct FetchRequest<'a> {
    url: &'a str,
}

#[derive(Deserialize)]
struct FetchMetadata {
    site_name: String,
    title: String,
    summary: String,
}

enum FetchOutcome {
    Preview(LinkPreviewView),
    Unavailable,
    Busy,
}

fn eligible_url(candidate: &str) -> Option<&str> {
    if candidate.len() > MAX_URL_BYTES {
        return None;
    }

    let (scheme, _) = candidate.split_once("://")?;
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return None;
    }

    let parsed = Url::parse(candidate).ok()?;
    let has_credentials = !parsed.username().is_empty() || parsed.password().is_some();
    if parsed.host().is_none() || parsed.port().is_some() || has_credentials {
        return None;
    }

    Some(candidate)
}

fn plain_url(text: &str) -> Option<&str> {
    let words = text.split(|character: char| {
        character.is_whitespace() || matches!(character, '<' | '>' | '"' | '\'')
    });
    for word in words {
        let candidate = word.trim_start_matches(OPENING_PROSE_WRAPPERS);
        let candidate = candidate.trim_end_matches(|character| {
            matches!(character, ',' | '.' | ';' | '!' | '。' | '，' | '；' | '！' | '？')
        });

        // Remove matching prose wrappers while preserving balanced parentheses within a URL.
        let candidate = if word.starts_with('(') {
            candidate.strip_suffix(')').unwrap_or(candidate)
        } else if word.starts_with('[') {
            candidate.strip_suffix(']').unwrap_or(candidate)
        } else if word.starts_with('{') {
            candidate.strip_suffix('}').unwrap_or(candidate)
        } else {
            candidate
        };

        if let Some(url) = eligible_url(candidate) {
            return Some(url);
        }
    }

    None
}

/// Find the first supported link in canonical plain text or canonical rich markup.
pub(crate) fn first_url(content: &MessageContent) -> Option<String> {
    let Some(html) = content.rich_text.as_deref() else {
        return plain_url(&content.text).map(str::to_owned);
    };

    let document = Html::parse_fragment(html);
    let root: ElementRef<'_> = document.root_element();
    root.descendants().find_map(|node| match node.value() {
        Node::Element(element) if element.name() == "a" => {
            let href = element.attr("href")?;
            eligible_url(href).map(str::to_owned)
        }
        Node::Text(text) => {
            // Anchor labels are display text; only their actual destination can supply a preview.
            let is_inside_anchor = node.ancestors().any(|ancestor| {
                matches!(ancestor.value(), Node::Element(element) if element.name() == "a")
            });
            if is_inside_anchor {
                return None;
            }

            plain_url(text).map(str::to_owned)
        }
        _ => None,
    })
}

/// Replace an older job or card with the intent for the current accepted content version.
pub(crate) async fn enqueue(
    connection: &mut PgConnection,
    intent: PreviewIntent<'_>,
) -> Result<(), sqlx::Error> {
    let Some(url) = intent.url else {
        let clear = sqlx::query(
            "DELETE FROM message_link_previews WHERE message_id = $1 AND content_version <= $2",
        );
        let clear = clear.bind(intent.message_id).bind(intent.content_version);
        clear.execute(connection).await?;
        return Ok(());
    };

    let upsert = sqlx::query(
        "INSERT INTO message_link_previews (message_id, content_version, target_url)
         VALUES ($1, $2, $3)
         ON CONFLICT (message_id) DO UPDATE SET
             content_version = EXCLUDED.content_version,
             target_url = EXCLUDED.target_url,
             available_at = clock_timestamp(),
             attempts = 0,
             lease_token = NULL,
             lease_until = NULL,
             finished_at = NULL,
             metadata = NULL
         WHERE message_link_previews.content_version < EXCLUDED.content_version",
    );
    let upsert = upsert.bind(intent.message_id).bind(intent.content_version).bind(url);
    upsert.execute(connection).await?;

    Ok(())
}

/// Remove the queued URL and any published card as part of a delete or expiry transaction.
pub(crate) async fn revoke(
    connection: &mut PgConnection,
    message_id: Uuid,
) -> Result<(), sqlx::Error> {
    let delete = sqlx::query("DELETE FROM message_link_previews WHERE message_id = $1");
    delete.bind(message_id).execute(connection).await?;

    Ok(())
}

async fn claim(pool: &PgPool) -> Result<Option<PreviewClaim>, sqlx::Error> {
    let claim = sqlx::query_as(
        "WITH candidate AS (
             SELECT preview.message_id
             FROM message_link_previews preview
             JOIN messages message ON message.id = preview.message_id
             JOIN conversations conversation ON conversation.id = message.conversation_id
             WHERE preview.finished_at IS NULL AND preview.attempts < $1
               AND preview.available_at <= clock_timestamp()
               AND (preview.lease_until IS NULL OR preview.lease_until <= clock_timestamp())
               AND message.version = preview.content_version AND NOT message.disable_link_preview
               AND message.deleted_at IS NULL
               AND (message.expires_at IS NULL OR message.expires_at > clock_timestamp())
               AND conversation.deleted_at IS NULL AND NOT conversation.is_quarantined
             ORDER BY preview.available_at, preview.message_id
             FOR UPDATE OF preview SKIP LOCKED LIMIT 1
         )
         UPDATE message_link_previews preview SET
             lease_token = $2, lease_until = clock_timestamp() + $3::bigint * interval '1 second',
             attempts = attempts + 1
         FROM candidate WHERE preview.message_id = candidate.message_id
         RETURNING preview.message_id, preview.content_version, preview.target_url,
                   preview.lease_token",
    );
    let claim = claim.bind(MAX_ATTEMPTS).bind(Uuid::new_v4()).bind(LEASE_SECONDS);

    claim.fetch_optional(pool).await
}

async fn lock_conversation(
    connection: &mut PgConnection,
    message_id: Uuid,
) -> Result<Option<access::LockedConversation>, sqlx::Error> {
    let lock = sqlx::query_as(
        "SELECT conversation.* FROM conversations conversation
         JOIN messages message ON message.conversation_id = conversation.id
         WHERE message.id = $1 AND conversation.deleted_at IS NULL
           AND NOT conversation.is_quarantined
         FOR UPDATE OF conversation",
    );

    lock.bind(message_id).fetch_optional(connection).await
}

async fn update_current_preview(
    connection: &mut PgConnection,
    claim: PreviewClaim,
    outcome: FetchOutcome,
) -> Result<Option<bool>, sqlx::Error> {
    let is_busy = matches!(outcome, FetchOutcome::Busy);
    let metadata = match outcome {
        FetchOutcome::Preview(metadata) => Some(Json(metadata)),
        FetchOutcome::Unavailable | FetchOutcome::Busy => None,
    };

    // Version, URL, and unexpired lease form one fence, including after a Worker reclaim.
    let update = sqlx::query_scalar(
        "UPDATE message_link_previews preview SET
             lease_token = NULL,
             lease_until = NULL,
             available_at = clock_timestamp() + $8::bigint * interval '1 second',
             finished_at = CASE WHEN $6 AND preview.attempts < $7
                 THEN NULL ELSE clock_timestamp() END,
             metadata = $5
         FROM messages message
         WHERE preview.message_id = $1 AND preview.content_version = $2
           AND preview.target_url = $3 AND preview.lease_token = $4
           AND preview.lease_until > clock_timestamp()
           AND message.id = preview.message_id AND message.version = preview.content_version
           AND message.deleted_at IS NULL AND NOT message.disable_link_preview
           AND (message.expires_at IS NULL OR message.expires_at > clock_timestamp())
         RETURNING preview.metadata IS NOT NULL",
    );
    let update = update.bind(claim.message_id).bind(claim.content_version).bind(claim.target_url);
    let update = update.bind(claim.lease_token).bind(metadata).bind(is_busy);
    let update = update.bind(MAX_ATTEMPTS).bind(RETRY_SECONDS);

    update.fetch_optional(connection).await
}

async fn finish(
    pool: &PgPool,
    claim: PreviewClaim,
    outcome: FetchOutcome,
) -> Result<(), AccountError> {
    let message_id = claim.message_id;
    let mut transaction = pool.begin().await?;
    let Some(conversation) = lock_conversation(&mut transaction, message_id).await? else {
        return Ok(());
    };

    // Match normal message writes before updating preview state or allocating feed positions.
    access::lock_participants(&mut transaction, &conversation)
        .await
        .map_err(|error| error.into_public())?;
    let is_published = update_current_preview(&mut transaction, claim, outcome).await?;
    if is_published == Some(true) {
        advance_interaction(&mut transaction, message_id).await?;
        let participants = access::participants(&mut transaction, &conversation).await?;
        changes::append(
            &mut transaction,
            ChangeGroup {
                participants: &participants,
                conversation_id: conversation.id,
                message_id: Some(message_id),
            },
        )
        .await?;
    }

    transaction.commit().await?;

    Ok(())
}

async fn read_metadata(mut response: Response) -> Option<FetchMetadata> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        // Keep the Worker bounded if the private endpoint returns an unexpected response.
        if chunk.len() > MAX_CONTROL_RESPONSE_BYTES - body.len() {
            return None;
        }

        body.extend_from_slice(&chunk);
    }

    let metadata: FetchMetadata = serde_json::from_slice(&body).ok()?;
    let has_useful_text = !metadata.title.trim().is_empty() || !metadata.summary.trim().is_empty();
    let is_bounded = metadata.site_name.chars().count() <= MAX_SITE_NAME_CHARS
        && metadata.title.chars().count() <= MAX_TITLE_CHARS
        && metadata.summary.chars().count() <= MAX_SUMMARY_CHARS;

    (has_useful_text && is_bounded).then_some(metadata)
}

impl LinkPreviews {
    /// Build a Worker client for the configured private fetcher control endpoint.
    pub fn new(pool: PgPool, endpoint: Url) -> Result<Self, AccountError> {
        let has_credentials = !endpoint.username().is_empty() || endpoint.password().is_some();
        let is_http = matches!(endpoint.scheme(), "http" | "https");
        if !is_http || endpoint.host().is_none() || has_credentials {
            return Err(AccountError::Unavailable);
        }

        // Only the fetcher can issue public requests, and control redirects must stay disabled.
        let client = Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none());
        let client = client.timeout(CONTROL_TIMEOUT).retry(reqwest::retry::never());
        let client = client.build().map_err(|_| AccountError::Unavailable)?;

        Ok(Self {
            pool,
            client,
            endpoint,
        })
    }

    /// Claim and complete one preview without holding a database transaction over HTTP.
    pub async fn process_next(&self) -> Result<bool, AccountError> {
        let Some(claim) = claim(&self.pool).await? else {
            return Ok(false);
        };

        let outcome = self.fetch(&claim.target_url).await;
        finish(&self.pool, claim, outcome).await?;

        Ok(true)
    }

    /// Process preview jobs until shutdown, leaving interrupted claims available for takeover.
    pub async fn run(&self, shutdown: CancellationToken) {
        loop {
            let result = tokio::select! {
                () = shutdown.cancelled() => break,
                result = self.process_next() => result,
            };
            match result {
                Ok(true) => continue,
                Ok(false) => {}
                Err(_) => tracing::warn!("link_preview_job_unavailable"),
            }

            tokio::select! {
                () = shutdown.cancelled() => break,
                () = sleep(POLL_INTERVAL) => {}
            }
        }
    }

    async fn fetch(&self, url: &str) -> FetchOutcome {
        let request = self.client.post(self.endpoint.clone()).json(&FetchRequest {
            url,
        });
        let Ok(response) = request.send().await else {
            return FetchOutcome::Unavailable;
        };
        if response.status() == StatusCode::SERVICE_UNAVAILABLE {
            return FetchOutcome::Busy;
        }
        if !response.status().is_success() {
            return FetchOutcome::Unavailable;
        }

        let Some(metadata) = read_metadata(response).await else {
            return FetchOutcome::Unavailable;
        };
        FetchOutcome::Preview(LinkPreviewView {
            url: url.to_owned(),
            site_name: metadata.site_name,
            title: metadata.title,
            summary: metadata.summary,
        })
    }
}
