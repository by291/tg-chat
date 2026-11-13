use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::features::{
    accounts::{AccountError, Actor},
    conversations::access::{self, LockedConversation},
    sync::changes::{self, ChangeGroup},
};

const DIRECTORY_LIMIT: i64 = 50;

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum QuarantineTarget {
    Case {
        case_id: Uuid,
    },
    Community {
        conversation_id: Uuid,
    },
}

pub(crate) struct QuarantineScope {
    pub conversation_id: Uuid,
    participants: Vec<Uuid>,
}

#[derive(FromRow, Serialize, ToSchema)]
pub struct OperatorCommunity {
    id: Uuid,
    title: String,
    kind: String,
    is_quarantined: bool,
}

/// Lock the source conversation and ordered affected accounts before the actor session.
pub(crate) async fn lock_scope(
    connection: &mut PgConnection,
    actor: &Actor,
    target: &QuarantineTarget,
) -> Result<QuarantineScope, AccountError> {
    let conversation = match target {
        QuarantineTarget::Case {
            case_id,
        } => {
            let lock = sqlx::query_as::<_, LockedConversation>(
                "SELECT conversation.* FROM conversations conversation
                 JOIN moderation_cases report ON report.conversation_id = conversation.id
                 WHERE report.id = $1 AND conversation.kind IN ('direct', 'group', 'channel')
                 AND conversation.deleted_at IS NULL FOR UPDATE OF conversation",
            );
            lock.bind(case_id).fetch_optional(&mut *connection).await?
        }
        QuarantineTarget::Community {
            conversation_id,
        } => {
            let lock = sqlx::query_as::<_, LockedConversation>(
                "SELECT * FROM conversations WHERE id = $1 AND kind IN ('group', 'channel')
                 AND deleted_at IS NULL FOR UPDATE",
            );
            lock.bind(conversation_id).fetch_optional(&mut *connection).await?
        }
    };
    let conversation = conversation.ok_or(AccountError::NotFound)?;
    let participants = access::participants(connection, &conversation).await?;
    let mut account_ids = participants.clone();
    account_ids.push(actor.user_id);
    account_ids.sort_unstable();
    account_ids.dedup();

    let lock = sqlx::query("SELECT id FROM users WHERE id = ANY($1) ORDER BY id FOR UPDATE");
    lock.bind(&account_ids).execute(connection).await?;

    Ok(QuarantineScope {
        conversation_id: conversation.id,
        participants,
    })
}

/// Publish a fresh visibility generation when the operator changes quarantine state.
pub(crate) async fn set(
    connection: &mut PgConnection,
    scope: QuarantineScope,
    is_quarantined: bool,
) -> Result<(), AccountError> {
    let update = sqlx::query(
        "UPDATE conversations SET is_quarantined = $2, version = version + 1
         WHERE id = $1 AND is_quarantined IS DISTINCT FROM $2",
    );
    let update = update.bind(scope.conversation_id).bind(is_quarantined);
    if update.execute(&mut *connection).await?.rows_affected() == 0 {
        return Ok(());
    }

    // The new generation also invalidates pages on clients that missed the removal event.
    let bump = sqlx::query(
        "UPDATE conversation_members SET generation = generation + 1
         WHERE conversation_id = $1 AND user_id = ANY($2)",
    );
    let bump = bump.bind(scope.conversation_id).bind(&scope.participants);
    bump.execute(&mut *connection).await?;
    changes::append(
        connection,
        ChangeGroup {
            participants: &scope.participants,
            conversation_id: scope.conversation_id,
            message_id: None,
        },
    )
    .await?;

    Ok(())
}

/// Find group and channel targets without enumerating private direct conversations.
pub(crate) async fn communities(
    connection: &mut PgConnection,
    search: &str,
    after: Option<Uuid>,
) -> Result<Vec<OperatorCommunity>, AccountError> {
    if search.len() > 200 {
        return Err(AccountError::Validation("community search is too long"));
    }
    let query = sqlx::query_as::<_, OperatorCommunity>(
        "SELECT id, title, kind::text AS kind, is_quarantined FROM conversations
         WHERE kind IN ('group', 'channel') AND deleted_at IS NULL
         AND ($1::uuid IS NULL OR id > $1)
         AND strpos(lower(title), lower($2)) > 0 ORDER BY id LIMIT $3",
    );
    let query = query.bind(after).bind(search).bind(DIRECTORY_LIMIT);
    Ok(query.fetch_all(connection).await?)
}
