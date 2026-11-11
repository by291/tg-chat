//! Restart-safe cleanup of terminal account state and shared-history invalidations.

use sqlx::{FromRow, PgConnection, PgPool};
use uuid::Uuid;

use crate::{
    accounts::AccountError,
    conversations::access::{self, LockedConversation},
    media::retire_account_uploads,
    messages::commands::delete_messages,
    sync::changes::{self, ChangeGroup},
};

const PRIVATE_BATCH_SIZE: i64 = 100;
const SAVED_MESSAGE_BATCH_SIZE: i64 = 25;

#[derive(FromRow)]
struct CleanupJob {
    user_id: Uuid,
    last_conversation_id: Option<Uuid>,
}

async fn next_shared_conversation(
    connection: &mut PgConnection,
    job: &CleanupJob,
) -> Result<Option<LockedConversation>, sqlx::Error> {
    let query = sqlx::query_as(
        "WITH saved AS (
             SELECT id FROM conversations WHERE kind = 'saved' AND participant_low = $1
         ), affected AS (
             (SELECT conversation_id FROM conversation_members
              WHERE user_id = $1 AND ($2::uuid IS NULL OR conversation_id > $2)
                AND conversation_id IS DISTINCT FROM (SELECT id FROM saved)
              ORDER BY conversation_id LIMIT 1)
             UNION ALL
             (SELECT conversation_id FROM messages
              WHERE author_id = $1 AND ($2::uuid IS NULL OR conversation_id > $2)
                AND conversation_id IS DISTINCT FROM (SELECT id FROM saved)
              ORDER BY conversation_id LIMIT 1)
         )
         SELECT conversation.* FROM conversations conversation
         WHERE conversation.id = (SELECT conversation_id FROM affected ORDER BY conversation_id LIMIT 1)
         FOR UPDATE OF conversation",
    );
    let query = query.bind(job.user_id).bind(job.last_conversation_id);
    query.fetch_optional(connection).await
}

async fn retire_membership(
    connection: &mut PgConnection,
    job: &CleanupJob,
) -> Result<bool, AccountError> {
    let Some(conversation) = next_shared_conversation(connection, job).await? else {
        return Ok(false);
    };

    // Match chat writes: lock the conversation, its participants, then the ordered feed heads.
    access::lock_participants(connection, &conversation)
        .await
        .map_err(|error| error.into_public())?;
    let remove =
        sqlx::query("DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2");
    remove.bind(conversation.id).bind(job.user_id).execute(&mut *connection).await?;

    invalidate_shared_history(connection, conversation.id).await?;

    let advance =
        sqlx::query("UPDATE account_cleanup_jobs SET last_conversation_id = $2 WHERE user_id = $1");
    advance.bind(job.user_id).bind(conversation.id).execute(connection).await?;

    Ok(true)
}

async fn invalidate_shared_history(
    connection: &mut PgConnection,
    conversation_id: Uuid,
) -> Result<(), sqlx::Error> {
    let version = sqlx::query(
        "UPDATE conversations SET version = version + 1 WHERE id = $1 AND deleted_at IS NULL",
    );
    if version.bind(conversation_id).execute(&mut *connection).await?.rows_affected() == 0 {
        return Ok(());
    }
    // The generation change refreshes cached author names without emitting every old message.
    let update = sqlx::query_scalar(
        "UPDATE conversation_members member SET generation = generation + 1
         FROM users account
         WHERE member.conversation_id = $1 AND member.user_id = account.id
           AND member.directory_active AND NOT member.is_banned AND account.deleted_at IS NULL
         RETURNING member.user_id",
    );
    let mut recipients: Vec<Uuid> =
        update.bind(conversation_id).fetch_all(&mut *connection).await?;
    recipients.sort_unstable();
    let change = ChangeGroup {
        participants: &recipients,
        conversation_id,
        message_id: None,
    };
    changes::append(connection, change).await
}

async fn scrub_saved_messages(
    connection: &mut PgConnection,
    user_id: Uuid,
) -> Result<bool, AccountError> {
    let saved = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM conversations
         WHERE kind = 'saved' AND participant_low = $1 AND deleted_at IS NULL FOR UPDATE",
    );
    let Some(saved_id) = saved.bind(user_id).fetch_optional(&mut *connection).await? else {
        return Ok(false);
    };

    let messages = sqlx::query_scalar(
        "SELECT id FROM messages WHERE conversation_id = $1 AND deleted_at IS NULL
         ORDER BY sequence LIMIT $2",
    );
    let messages = messages.bind(saved_id).bind(SAVED_MESSAGE_BATCH_SIZE);
    let message_ids: Vec<Uuid> = messages.fetch_all(&mut *connection).await?;
    if !message_ids.is_empty() {
        delete_messages(connection, &message_ids).await.map_err(|error| error.into_public())?;
        return Ok(true);
    }

    let remove = sqlx::query("DELETE FROM conversation_members WHERE conversation_id = $1");
    remove.bind(saved_id).execute(&mut *connection).await?;
    let retire = sqlx::query(
        "UPDATE conversations SET deleted_at = now(), summary_text = '', avatar_file_id = NULL
         WHERE id = $1",
    );
    retire.bind(saved_id).execute(connection).await?;

    Ok(true)
}

async fn clear_relationships(
    connection: &mut PgConnection,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let statements = [
        "DELETE FROM contacts WHERE (owner_id, target_id) IN (
             SELECT owner_id, target_id FROM contacts WHERE owner_id = $1 OR target_id = $1
             ORDER BY owner_id, target_id LIMIT $2 FOR UPDATE
         )",
        "DELETE FROM blocks WHERE (owner_id, target_id) IN (
             SELECT owner_id, target_id FROM blocks WHERE owner_id = $1 OR target_id = $1
             ORDER BY owner_id, target_id LIMIT $2 FOR UPDATE
         )",
        "DELETE FROM hidden_messages WHERE (user_id, message_id) IN (
             SELECT user_id, message_id FROM hidden_messages WHERE user_id = $1
             ORDER BY message_id LIMIT $2
         )",
    ];
    for statement in statements {
        let delete = sqlx::query(statement).bind(user_id).bind(PRIVATE_BATCH_SIZE);
        if delete.execute(&mut *connection).await?.rows_affected() > 0 {
            return Ok(true);
        }
    }

    Ok(false)
}

async fn retire_invitations(
    connection: &mut PgConnection,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let requests = sqlx::query(
        "DELETE FROM community_join_requests WHERE (conversation_id, user_id) IN (
             SELECT request.conversation_id, request.user_id FROM community_join_requests request
             LEFT JOIN community_invitations invitation ON invitation.id = request.invitation_id
             WHERE request.user_id = $1 OR invitation.created_by = $1
             ORDER BY request.conversation_id, request.user_id LIMIT $2
             FOR UPDATE OF request
         )",
    );
    let requests = requests.bind(user_id).bind(PRIVATE_BATCH_SIZE);
    if requests.execute(&mut *connection).await?.rows_affected() > 0 {
        return Ok(true);
    }

    let invitations = sqlx::query(
        "UPDATE community_invitations SET revoked_at = clock_timestamp()
         WHERE id IN (
             SELECT id FROM community_invitations
             WHERE revoked_at IS NULL AND (created_by = $1 OR target_id = $1)
             ORDER BY id LIMIT $2 FOR UPDATE
         )",
    );
    let invitations = invitations.bind(user_id).bind(PRIVATE_BATCH_SIZE);
    let revoked = invitations.execute(connection).await?.rows_affected();

    Ok(revoked > 0)
}

async fn scrub_credentials(
    connection: &mut PgConnection,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let select = sqlx::query_scalar(
        "SELECT id FROM email_challenges WHERE user_id = $1 ORDER BY id LIMIT $2",
    );
    let select = select.bind(user_id).bind(PRIVATE_BATCH_SIZE);
    let challenge_ids: Vec<Uuid> = select.fetch_all(&mut *connection).await?;
    if !challenge_ids.is_empty() {
        let jobs = sqlx::query("DELETE FROM mail_jobs WHERE challenge_id = ANY($1)");
        jobs.bind(&challenge_ids).execute(&mut *connection).await?;
        let challenges = sqlx::query("DELETE FROM email_challenges WHERE id = ANY($1)");
        challenges.bind(&challenge_ids).execute(connection).await?;
        return Ok(true);
    }

    // Uploads can still reference revoked sessions, so erase their device labels in place.
    let scrub = sqlx::query(
        "UPDATE sessions SET device_name = 'Deleted device' WHERE id IN (
             SELECT id FROM sessions WHERE user_id = $1 AND device_name <> 'Deleted device'
             ORDER BY id LIMIT $2
         )",
    );
    let scrub = scrub.bind(user_id).bind(PRIVATE_BATCH_SIZE);
    let cleaned = scrub.execute(connection).await?.rows_affected();

    Ok(cleaned > 0)
}

async fn clean_one_unit(
    connection: &mut PgConnection,
    job: &CleanupJob,
) -> Result<(), AccountError> {
    if retire_membership(connection, job).await? {
        return Ok(());
    }
    if scrub_saved_messages(connection, job.user_id).await? {
        return Ok(());
    }
    if clear_relationships(connection, job.user_id).await? {
        return Ok(());
    }
    if retire_invitations(connection, job.user_id).await? {
        return Ok(());
    }
    if scrub_credentials(connection, job.user_id).await? {
        return Ok(());
    }
    if retire_account_uploads(connection, job.user_id, PRIVATE_BATCH_SIZE).await? {
        return Ok(());
    }

    let clear_preferences =
        sqlx::query("DELETE FROM account_preferences WHERE user_id = $1").bind(job.user_id);
    clear_preferences.execute(&mut *connection).await?;
    let clear_quota =
        sqlx::query("DELETE FROM account_storage_limits WHERE user_id = $1").bind(job.user_id);
    clear_quota.execute(&mut *connection).await?;

    let complete =
        sqlx::query("UPDATE account_cleanup_jobs SET completed_at = now() WHERE user_id = $1");
    complete.bind(job.user_id).execute(connection).await?;

    Ok(())
}

/// Lock and commit one bounded unit of account cleanup so another Worker can safely resume it.
pub async fn cleanup_deleted_account(pool: &PgPool) -> Result<bool, AccountError> {
    let mut transaction = pool.begin().await?;
    let query = sqlx::query_as(
        "SELECT user_id, last_conversation_id FROM account_cleanup_jobs
         WHERE completed_at IS NULL ORDER BY created_at, user_id LIMIT 1 FOR UPDATE SKIP LOCKED",
    );
    let Some(job) = query.fetch_optional(&mut *transaction).await? else {
        return Ok(false);
    };
    clean_one_unit(&mut transaction, &job).await?;
    transaction.commit().await?;

    Ok(true)
}
