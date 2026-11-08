use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use uuid::Uuid;

use super::{DirectoryPage, DirectoryQuery, PublicProfile};
use crate::accounts::{AccountError, AccountService, Actor, sessions::lock_actor};

const DEFAULT_PAGE_SIZE: u16 = 20;
const MAX_PAGE_SIZE: u16 = 50;
const MAX_SEARCH_LENGTH: usize = 80;
const MIN_SEARCH_LENGTH: usize = 2;

pub(super) enum DirectoryKind {
    Discovery,
    Contacts,
    Blocks,
}

struct DirectoryRequest<'request> {
    actor: &'request Actor,
    query: DirectoryQuery,
    kind: DirectoryKind,
}

struct PageWindow {
    search: String,
    after: Uuid,
    limit: u16,
}

fn validate_window(query: DirectoryQuery) -> Result<PageWindow, AccountError> {
    let limit = query.limit.unwrap_or(DEFAULT_PAGE_SIZE);
    if !(1..=MAX_PAGE_SIZE).contains(&limit) {
        return Err(AccountError::Validation("page size must be between 1 and 50"));
    }
    let search = query.search.unwrap_or_default().trim().to_owned();
    if search.chars().count() > MAX_SEARCH_LENGTH {
        return Err(AccountError::Validation("search text is too long"));
    }
    let after = match query.cursor {
        None => Uuid::nil(),
        Some(cursor) => {
            let decoded = URL_SAFE_NO_PAD
                .decode(cursor)
                .map_err(|_| AccountError::Validation("invalid directory cursor"))?;
            Uuid::from_slice(&decoded)
                .map_err(|_| AccountError::Validation("invalid directory cursor"))?
        }
    };

    Ok(PageWindow {
        search,
        after,
        limit,
    })
}

impl AccountService {
    /// Search active users by public username or display name without exposing private fields.
    pub async fn discover(
        &self,
        actor: &Actor,
        query: DirectoryQuery,
    ) -> Result<DirectoryPage, AccountError> {
        let search = query.search.as_deref().unwrap_or_default();
        let search_length = search.trim().chars().count();
        if search_length < MIN_SEARCH_LENGTH {
            return Err(AccountError::Validation(
                "directory search requires at least two characters",
            ));
        }

        self.directory(DirectoryRequest {
            actor,
            query,
            kind: DirectoryKind::Discovery,
        })
        .await
    }

    /// Page the caller's saved contacts in a stable ID order.
    pub async fn contacts(
        &self,
        actor: &Actor,
        query: DirectoryQuery,
    ) -> Result<DirectoryPage, AccountError> {
        self.directory(DirectoryRequest {
            actor,
            query,
            kind: DirectoryKind::Contacts,
        })
        .await
    }

    /// Page only blocks created by the caller, without revealing incoming blocks.
    pub async fn blocks(
        &self,
        actor: &Actor,
        query: DirectoryQuery,
    ) -> Result<DirectoryPage, AccountError> {
        self.directory(DirectoryRequest {
            actor,
            query,
            kind: DirectoryKind::Blocks,
        })
        .await
    }

    async fn directory(
        &self,
        request: DirectoryRequest<'_>,
    ) -> Result<DirectoryPage, AccountError> {
        let actor = request.actor;
        let window = validate_window(request.query)?;
        let directory_kind = match request.kind {
            DirectoryKind::Discovery => "discovery",
            DirectoryKind::Contacts => "contacts",
            DirectoryKind::Blocks => "blocks",
        };
        let mut transaction = self.pool.begin().await?;
        lock_actor(&mut transaction, actor, &self.settings).await?;
        // Saved relationships must remain manageable even when their target is suspended.
        let query = sqlx::query_as::<_, PublicProfile>(
            "SELECT id, username, display_name, biography FROM users
             WHERE id > $2 AND ($5 <> 'discovery' OR NOT is_suspended)
             AND (strpos(username, lower($3)) > 0 OR strpos(lower(display_name), lower($3)) > 0)
             AND (
                ($5 = 'discovery' AND id <> $1)
                OR ($5 = 'contacts' AND EXISTS (
                    SELECT 1 FROM contacts WHERE owner_id = $1 AND target_id = users.id
                ))
                OR ($5 = 'blocks' AND EXISTS (
                    SELECT 1 FROM blocks WHERE owner_id = $1 AND target_id = users.id
                ))
             ) ORDER BY id LIMIT $4",
        )
        .bind(actor.user_id)
        .bind(window.after);
        let query =
            query.bind(window.search).bind(i64::from(window.limit) + 1).bind(directory_kind);
        let mut users = query.fetch_all(&mut *transaction).await?;
        transaction.commit().await?;
        let has_more = users.len() > usize::from(window.limit);
        users.truncate(usize::from(window.limit));
        let next_cursor = if has_more {
            users.last().map(|user| URL_SAFE_NO_PAD.encode(user.id.as_bytes()))
        } else {
            None
        };

        Ok(DirectoryPage {
            users,
            next_cursor,
        })
    }
}
