use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{
    CanonicalMessage, CommandAction, commands::CommandContext, history::parse_sequence,
    service::AcceptanceError,
};
use crate::features::{accounts::AccountError, conversations::access};

const MAX_TASKS: usize = 10;
const TEXT_LIMIT: usize = 255;

#[derive(Clone, Debug, Deserialize, FromRow, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ChecklistTaskInput {
    pub id: Uuid,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ChecklistInput {
    pub title: String,
    pub tasks: Vec<ChecklistTaskInput>,
    #[serde(default)]
    pub can_others_complete: bool,
    #[serde(default)]
    pub can_others_append: bool,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct ChecklistCompleter {
    pub user_id: Uuid,
    pub display_name: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct ChecklistTaskView {
    pub id: Uuid,
    pub text: String,
    pub version: String,
    pub is_complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_by: Option<ChecklistCompleter>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct ChecklistView {
    pub title: String,
    pub tasks: Vec<ChecklistTaskView>,
    pub list_version: String,
    pub can_others_complete: bool,
    pub can_others_append: bool,
    pub can_complete: bool,
    pub can_append: bool,
    pub can_edit: bool,
}

pub(super) struct ChecklistReader<'a> {
    pub message: &'a CanonicalMessage,
    pub user_id: Uuid,
}

#[derive(FromRow)]
struct ChecklistRecord {
    title: String,
    list_version: i64,
    can_others_complete: bool,
    can_others_append: bool,
}

#[derive(FromRow)]
struct TaskRecord {
    id: Uuid,
    text: String,
    version: i64,
    is_complete: bool,
    completer_id: Option<Uuid>,
    completer_name: Option<String>,
}

struct TaskCompletion<'a> {
    task_id: Uuid,
    expected_task_version: &'a str,
    is_complete: bool,
}

struct ChecklistMutation {
    message_id: Uuid,
    actor_id: Uuid,
    is_author: bool,
    current: ChecklistRecord,
}

fn normalize_text(text: &mut String, error: &'static str) -> Result<(), AccountError> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.contains('\0') || trimmed.encode_utf16().count() > TEXT_LIMIT {
        return Err(AccountError::Validation(error));
    }
    *text = trimmed.to_owned();

    Ok(())
}

/// Normalize a nonempty collection of distinct task IDs and validate its labels.
pub(super) fn normalize_tasks(tasks: &mut [ChecklistTaskInput]) -> Result<(), AccountError> {
    if tasks.is_empty() || tasks.len() > MAX_TASKS {
        return Err(AccountError::Validation("a checklist needs between one and ten tasks"));
    }

    let mut ids = HashSet::with_capacity(tasks.len());
    for task in tasks {
        normalize_text(&mut task.text, "invalid checklist task text")?;
        if !ids.insert(task.id) {
            return Err(AccountError::Validation("duplicate checklist task ID"));
        }
    }

    Ok(())
}

/// Normalize authored checklist content before comparing operation payloads.
pub(super) fn normalize(checklist: &mut ChecklistInput) -> Result<(), AccountError> {
    normalize_text(&mut checklist.title, "invalid checklist title")?;
    normalize_tasks(&mut checklist.tasks)
}

async fn write_tasks(
    connection: &mut PgConnection,
    message_id: Uuid,
    tasks: &[ChecklistTaskInput],
) -> Result<(), sqlx::Error> {
    let ids: Vec<Uuid> = tasks.iter().map(|task| task.id).collect();
    let texts: Vec<&str> = tasks.iter().map(|task| task.text.as_str()).collect();

    // Retire missing IDs so a stale completion cannot act on a later task reusing an ID.
    let retire = sqlx::query(
        "UPDATE message_checklist_tasks SET text = NULL, position = NULL, is_complete = false,
                completed_by = NULL
         WHERE message_id = $1 AND position IS NOT NULL AND NOT (id = ANY($2))",
    );
    let retire = retire.bind(message_id).bind(&ids);
    retire.execute(&mut *connection).await?;

    // Keep the independent completion state for retained tasks during reordering and editing.
    let write = sqlx::query(
        "INSERT INTO message_checklist_tasks (message_id, id, text, position)
         SELECT $1, id, text, position FROM unnest($2::uuid[], $3::text[])
             WITH ORDINALITY AS task(id, text, position)
         ON CONFLICT (message_id, id) DO UPDATE
             SET text = EXCLUDED.text,
                 position = EXCLUDED.position,
                 version = message_checklist_tasks.version
                     + CASE WHEN message_checklist_tasks.position IS NULL THEN 1 ELSE 0 END",
    );
    let write = write.bind(message_id).bind(ids).bind(texts);
    write.execute(connection).await?;

    Ok(())
}

/// Store checklist structure and tasks in the message acceptance transaction.
pub(super) async fn insert(
    connection: &mut PgConnection,
    message_id: Uuid,
    checklist: &ChecklistInput,
) -> Result<(), sqlx::Error> {
    let insert = sqlx::query(
        "INSERT INTO message_checklists (message_id, title, can_others_complete, can_others_append)
         VALUES ($1, $2, $3, $4)",
    );
    let insert = insert.bind(message_id).bind(&checklist.title);
    let insert = insert.bind(checklist.can_others_complete).bind(checklist.can_others_append);
    insert.execute(&mut *connection).await?;
    write_tasks(connection, message_id, &checklist.tasks).await
}

async fn read_checklist(
    connection: &mut PgConnection,
    message_id: Uuid,
) -> Result<Option<ChecklistRecord>, sqlx::Error> {
    let query = sqlx::query_as(
        "SELECT title, list_version, can_others_complete, can_others_append
         FROM message_checklists WHERE message_id = $1",
    );
    query.bind(message_id).fetch_optional(connection).await
}

fn task_view(task: TaskRecord) -> ChecklistTaskView {
    let attribution = task.completer_id.zip(task.completer_name);
    let completed_by = attribution.map(|(user_id, display_name)| ChecklistCompleter {
        user_id,
        display_name,
    });
    ChecklistTaskView {
        id: task.id,
        text: task.text,
        version: task.version.to_string(),
        is_complete: task.is_complete,
        completed_by,
    }
}

async fn read_task_views(
    connection: &mut PgConnection,
    reader: &ChecklistReader<'_>,
) -> Result<Vec<ChecklistTaskView>, AccountError> {
    // Filter the identity at the join so a subscriber only receives their own attribution.
    let query = sqlx::query_as::<_, TaskRecord>(
        "SELECT task.id, task.text, task.version, task.is_complete,
                completer.id AS completer_id, completer.display_name AS completer_name
         FROM message_checklist_tasks task
         JOIN conversations conversation ON conversation.id = $2
         LEFT JOIN users completer ON completer.id = task.completed_by
             AND (conversation.kind <> 'channel' OR task.completed_by = $3 OR EXISTS (
                 SELECT 1 FROM conversation_members viewer
                 WHERE viewer.conversation_id = conversation.id AND viewer.user_id = $3
                   AND viewer.directory_active AND NOT viewer.is_banned
                   AND viewer.role IN ('owner', 'admin')))
         WHERE task.message_id = $1 AND task.position IS NOT NULL
         ORDER BY task.position",
    );
    let query = query.bind(reader.message.id).bind(reader.message.conversation_id);
    let records = query.bind(reader.user_id).fetch_all(connection).await?;

    Ok(records.into_iter().map(task_view).collect())
}

/// Project ordered tasks with the completion attribution this reader is allowed to see.
pub(super) async fn view(
    connection: &mut PgConnection,
    reader: ChecklistReader<'_>,
) -> Result<ChecklistView, AccountError> {
    let checklist = read_checklist(connection, reader.message.id).await?;
    let checklist = checklist.ok_or(AccountError::NotFound)?;
    let tasks = read_task_views(connection, &reader).await?;
    let is_author = reader.message.author_id == reader.user_id;
    let can_interact =
        access::can_interact(connection, reader.user_id, reader.message.conversation_id).await?;
    let can_complete = can_interact && (is_author || checklist.can_others_complete);
    let can_append =
        can_interact && (is_author || checklist.can_others_append) && tasks.len() < MAX_TASKS;

    Ok(ChecklistView {
        title: checklist.title,
        tasks,
        list_version: checklist.list_version.to_string(),
        can_others_complete: checklist.can_others_complete,
        can_others_append: checklist.can_others_append,
        can_complete,
        can_append,
        can_edit: can_interact && is_author,
    })
}

async fn set_task(
    connection: &mut PgConnection,
    mutation: &ChecklistMutation,
    completion: TaskCompletion<'_>,
) -> Result<(), AcceptanceError> {
    if !mutation.is_author && !mutation.current.can_others_complete {
        return Err(AccountError::MessageConflict.into());
    }

    let expected_version = parse_sequence(completion.expected_task_version)?;
    // Preserve the version and completer when the requested state already holds.
    let update = sqlx::query(
        "UPDATE message_checklist_tasks
         SET is_complete = $4,
             version = version + CASE WHEN is_complete <> $4 THEN 1 ELSE 0 END,
             completed_by = CASE WHEN NOT $4 THEN NULL
                                 WHEN NOT is_complete THEN $5
                                 ELSE completed_by END
         WHERE message_id = $1 AND id = $2 AND version = $3 AND position IS NOT NULL",
    );
    let update = update.bind(mutation.message_id).bind(completion.task_id).bind(expected_version);
    let update = update.bind(completion.is_complete).bind(mutation.actor_id);
    let result = update.execute(connection).await?;
    if result.rows_affected() == 0 {
        return Err(AccountError::MessageConflict.into());
    }

    Ok(())
}

async fn update_structure(
    connection: &mut PgConnection,
    message_id: Uuid,
    checklist: &ChecklistInput,
) -> Result<(), sqlx::Error> {
    let update = sqlx::query(
        "UPDATE message_checklists SET title = $2, can_others_complete = $3,
                can_others_append = $4, list_version = list_version + 1
         WHERE message_id = $1",
    );
    let update = update.bind(message_id).bind(&checklist.title);
    let update = update.bind(checklist.can_others_complete).bind(checklist.can_others_append);
    update.execute(&mut *connection).await?;
    write_tasks(connection, message_id, &checklist.tasks).await
}

fn require_list_version(current: &ChecklistRecord, expected: &str) -> Result<(), AccountError> {
    if current.list_version != parse_sequence(expected)? {
        return Err(AccountError::MessageConflict);
    }

    Ok(())
}

struct TaskAppend<'a> {
    expected_list_version: &'a str,
    tasks: &'a [ChecklistTaskInput],
}

async fn append_tasks(
    connection: &mut PgConnection,
    mutation: &ChecklistMutation,
    append: TaskAppend<'_>,
) -> Result<(), AcceptanceError> {
    if !mutation.is_author && !mutation.current.can_others_append {
        return Err(AccountError::MessageConflict.into());
    }
    require_list_version(&mutation.current, append.expected_list_version)?;

    let query = sqlx::query_as(
        "SELECT id, text FROM message_checklist_tasks
         WHERE message_id = $1 AND position IS NOT NULL ORDER BY position",
    );
    let mut tasks: Vec<ChecklistTaskInput> =
        query.bind(mutation.message_id).fetch_all(&mut *connection).await?;
    tasks.extend_from_slice(append.tasks);
    normalize_tasks(&mut tasks)?;

    let checklist = ChecklistInput {
        title: mutation.current.title.clone(),
        tasks,
        can_others_complete: mutation.current.can_others_complete,
        can_others_append: mutation.current.can_others_append,
    };
    update_structure(connection, mutation.message_id, &checklist).await?;

    Ok(())
}

/// Apply checklist commands while message visibility and participant policy are locked.
pub(super) async fn apply(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
    message: &CanonicalMessage,
) -> Result<(), AcceptanceError> {
    access::authorize_interaction(connection, context.actor, context.conversation).await?;

    // The conversation lock serializes policy and structure changes with task completion.
    let current = read_checklist(connection, message.id).await?;
    let current = current.ok_or(AccountError::NotFound)?;
    let actor_id = context.actor.user_id;
    let mutation = ChecklistMutation {
        message_id: message.id,
        actor_id,
        is_author: message.author_id == actor_id,
        current,
    };
    match &context.input.action {
        CommandAction::SetChecklistTask {
            task_id,
            expected_task_version,
            is_complete,
            ..
        } => {
            let completion = TaskCompletion {
                task_id: *task_id,
                expected_task_version,
                is_complete: *is_complete,
            };
            set_task(connection, &mutation, completion).await?;
        }
        CommandAction::AppendChecklistTasks {
            expected_list_version,
            tasks,
            ..
        } => {
            let append = TaskAppend {
                expected_list_version,
                tasks,
            };
            append_tasks(connection, &mutation, append).await?;
        }
        CommandAction::EditChecklist {
            expected_list_version,
            checklist,
            ..
        } => {
            if !mutation.is_author {
                return Err(AccountError::NotFound.into());
            }
            require_list_version(&mutation.current, expected_list_version)?;
            update_structure(connection, mutation.message_id, checklist).await?;
        }
        _ => return Err(AccountError::Validation("expected a checklist action").into()),
    }

    Ok(())
}

/// Remove checklist content and attribution when its message becomes a tombstone.
pub(crate) async fn delete(
    connection: &mut PgConnection,
    message_id: Uuid,
) -> Result<(), sqlx::Error> {
    let delete = sqlx::query("DELETE FROM message_checklists WHERE message_id = $1");
    delete.bind(message_id).execute(connection).await?;

    Ok(())
}
