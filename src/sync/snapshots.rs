use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection, QueryBuilder};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use super::cursor::CursorScope;
use crate::{
    accounts::{AccountError, Actor, PrivateProfile, model::UserRecord},
    contacts::{PrivacySettings, PublicProfile},
    conversations::{self, ConversationView},
    messages::{CanonicalMessage, MessageService, acceptance, history::page_size},
};

#[derive(Serialize, ToSchema)]
pub struct Bootstrap {
    pub deployment_id: Uuid,
    pub user: PrivateProfile,
    pub privacy: PrivacySettings,
    pub contacts: Vec<PublicProfile>,
    pub blocks: Vec<PublicProfile>,
    pub conversations: Vec<ConversationView>,
    pub cursor: String,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct SyncQuery {
    pub cursor: String,
    pub limit: Option<u16>,
}

#[derive(Serialize, ToSchema)]
pub struct SyncGroup {
    pub position: String,
    pub conversation: ConversationView,
    pub message: Option<CanonicalMessage>,
}

#[derive(Serialize, ToSchema)]
pub struct SyncPage {
    pub groups: Vec<SyncGroup>,
    pub cursor: String,
    pub observation_cursor: String,
    pub has_more: bool,
}

#[derive(FromRow)]
struct ChangeReference {
    position: i64,
    conversation_id: Uuid,
    message_id: Option<Uuid>,
}

async fn relationships(
    connection: &mut PgConnection,
    user_id: Uuid,
    kind: &str,
) -> Result<Vec<PublicProfile>, AccountError> {
    let query = sqlx::query_as(
        "SELECT id, username, display_name, biography FROM users WHERE
         ($2 = 'contacts' AND EXISTS (SELECT 1 FROM contacts WHERE owner_id = $1 AND target_id = id))
         OR ($2 = 'blocks' AND EXISTS (SELECT 1 FROM blocks WHERE owner_id = $1 AND target_id = id))
         ORDER BY id",
    )
    .bind(user_id)
    .bind(kind);

    Ok(query.fetch_all(connection).await?)
}

impl MessageService {
    /// Read private bootstrap state and its feed position from one repeatable-read snapshot.
    pub async fn bootstrap(&self, actor: Actor) -> Result<Bootstrap, AccountError> {
        self.ensure_saved(actor.clone()).await?;
        let mut transaction = self.snapshot(&actor).await?;
        let user: UserRecord = sqlx::query_as("SELECT * FROM users WHERE id = $1")
            .bind(actor.user_id)
            .fetch_one(&mut *transaction)
            .await?;
        let privacy = sqlx::query_as("SELECT * FROM users WHERE id = $1")
            .bind(actor.user_id)
            .fetch_one(&mut *transaction)
            .await?;
        let contacts = relationships(&mut transaction, actor.user_id, "contacts").await?;
        let blocks = relationships(&mut transaction, actor.user_id, "blocks").await?;
        let mut statement = QueryBuilder::new(conversations::VIEW_SELECT);
        statement
            .push(" WHERE member.directory_active AND member.user_id = ")
            .push_bind(actor.user_id);
        statement.push(" ORDER BY conversation.updated_at DESC, conversation.id");
        let conversations = statement.build_query_as().fetch_all(&mut *transaction).await?;
        let scope = CursorScope::read(&mut transaction, actor.user_id).await?;
        transaction.commit().await?;

        Ok(Bootstrap {
            deployment_id: scope.deployment_id,
            user: user.private_profile(),
            privacy,
            contacts,
            blocks,
            conversations,
            cursor: scope.encode(scope.position),
        })
    }

    /// Return complete committed groups with current authorized entities from one observation point.
    pub async fn sync(&self, actor: Actor, query: SyncQuery) -> Result<SyncPage, AccountError> {
        let limit = page_size(query.limit)?;
        let mut transaction = self.snapshot(&actor).await?;
        let scope = CursorScope::read(&mut transaction, actor.user_id).await?;
        let after = scope.decode(&query.cursor)?;
        let references = sqlx::query_as::<_, ChangeReference>(
            "SELECT position, conversation_id, message_id FROM personal_changes
             WHERE user_id = $1 AND position > $2 ORDER BY position LIMIT $3",
        )
        .bind(actor.user_id)
        .bind(after)
        .bind(limit);
        let references = references.fetch_all(&mut *transaction).await?;
        let mut groups = Vec::with_capacity(references.len());
        let mut position = after;
        for reference in references {
            let conversation =
                conversations::view(&mut transaction, actor.user_id, reference.conversation_id)
                    .await?;
            let message = match reference.message_id {
                Some(id) => {
                    Some(acceptance::receipt(&mut transaction, actor.user_id, id).await?.message)
                }
                None => None,
            };
            position = reference.position;
            groups.push(SyncGroup {
                position: position.to_string(),
                conversation,
                message,
            });
        }
        let has_more = position < scope.position;
        transaction.commit().await?;

        Ok(SyncPage {
            groups,
            cursor: scope.encode(position),
            observation_cursor: scope.encode(scope.position),
            has_more,
        })
    }
}
