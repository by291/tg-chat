use sqlx::{PgConnection, Postgres, QueryBuilder};
use uuid::Uuid;

use super::{CanonicalMessage, ReactionView, ReplyView};
use crate::accounts::AccountError;

/// Add the common account visibility predicate before pagination or direct lookup.
pub(crate) fn restrict_visible(statement: &mut QueryBuilder<Postgres>, user_id: Uuid) {
    statement.push(
        " AND message.deleted_at IS NULL
          AND (message.expires_at IS NULL OR message.expires_at > now())
          AND EXISTS (SELECT 1 FROM conversation_members visibility
              WHERE visibility.conversation_id = message.conversation_id
                AND visibility.directory_active AND visibility.user_id = ",
    );
    statement.push_bind(user_id);
    statement.push(" AND message.sequence > visibility.clear_through)");
    statement.push(" AND NOT EXISTS (SELECT 1 FROM hidden_messages hidden WHERE hidden.user_id = ");
    statement.push_bind(user_id);
    statement.push(" AND hidden.message_id = message.id)");
}

/// Derive reactions and reply availability from the reader's current authorized snapshot.
pub(crate) async fn personalize(
    connection: &mut PgConnection,
    user_id: Uuid,
    message: &mut CanonicalMessage,
) -> Result<(), AccountError> {
    if message.is_deleted {
        message.reply = None;
        message.is_pinned = false;
        return Ok(());
    }
    let reactions = sqlx::query_as::<_, ReactionView>(
        "SELECT emoji, count(*)::text AS count, bool_or(user_id = $2) AS is_selected
         FROM message_reactions WHERE message_id = $1 GROUP BY emoji ORDER BY emoji",
    )
    .bind(message.id)
    .bind(user_id);
    message.reactions = reactions.fetch_all(&mut *connection).await?;

    let Some(target_id) = message.reply_id else {
        return Ok(());
    };
    let mut statement = QueryBuilder::new(
        "SELECT message.content->>'text' FROM messages message WHERE message.id = ",
    );
    statement.push_bind(target_id);
    restrict_visible(&mut statement, user_id);
    let source: Option<String> = statement.build_query_scalar().fetch_optional(connection).await?;
    // Never retain an old quote after its target is hidden, cleared, deleted, or expired.
    let quote = source.as_ref().and_then(|text| {
        message.reply_quote.as_ref().filter(|quote| text.contains(quote.as_str())).cloned()
    });
    message.reply = Some(ReplyView {
        message_id: target_id,
        is_unavailable: source.is_none(),
        quote,
    });

    Ok(())
}

pub(crate) struct ReplyCheck<'a> {
    pub user_id: Uuid,
    pub conversation_id: Uuid,
    pub reply: &'a super::ReplyInput,
}

/// Validate a reply against a currently visible source in the same conversation.
pub(crate) async fn validate_reply(
    connection: &mut PgConnection,
    check: ReplyCheck<'_>,
) -> Result<(), AccountError> {
    let mut statement = QueryBuilder::new(
        "SELECT message.content->>'text' FROM messages message WHERE message.id = ",
    );
    statement.push_bind(check.reply.message_id);
    statement.push(" AND message.conversation_id = ").push_bind(check.conversation_id);
    restrict_visible(&mut statement, check.user_id);
    let source: Option<String> = statement.build_query_scalar().fetch_optional(connection).await?;
    let source = source.ok_or(AccountError::NotFound)?;
    let is_invalid_quote =
        check.reply.quote.as_ref().is_some_and(|quote| quote.is_empty() || !source.contains(quote));
    if is_invalid_quote {
        return Err(AccountError::Validation("quote must occur in the reply target"));
    }

    Ok(())
}
