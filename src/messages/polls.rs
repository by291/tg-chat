use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection, Postgres, QueryBuilder, types::Json};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use super::{
    CanonicalMessage, CommandAction, MessageService, commands::CommandContext, history,
    projection::restrict_visible, service::AcceptanceError,
};
use crate::{
    accounts::{AccountError, Actor},
    conversations::access::{self, LockedConversation},
};

const MIN_OPTIONS: usize = 2;
const MAX_OPTIONS: usize = 12;
const QUESTION_LIMIT: usize = 255;
const DESCRIPTION_LIMIT: usize = 1024;
const OPTION_LIMIT: usize = 100;
const EXPLANATION_LIMIT: usize = 200;
const VOTER_PAGE_SIZE: usize = 30;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PollOptionInput {
    pub id: Uuid,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct QuizInput {
    pub correct_option_ids: Vec<Uuid>,
    pub explanation: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PollInput {
    pub question: String,
    pub description: Option<String>,
    pub options: Vec<PollOptionInput>,
    pub is_anonymous: bool,
    #[serde(default)]
    pub is_multiple_choice: bool,
    #[serde(default)]
    pub can_revote: bool,
    #[serde(default)]
    pub can_add_options: bool,
    #[serde(default)]
    pub hide_results_until_close: bool,
    pub closes_at: Option<DateTime<Utc>>,
    pub quiz: Option<QuizInput>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct PollOptionView {
    pub id: Uuid,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub votes: Option<i64>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct PollView {
    pub question: String,
    pub description: Option<String>,
    pub options: Vec<PollOptionView>,
    pub version: String,
    pub is_anonymous: bool,
    pub is_multiple_choice: bool,
    pub can_revote: bool,
    pub can_add_options: bool,
    pub can_vote: bool,
    pub can_edit: bool,
    pub can_close: bool,
    pub hide_results_until_close: bool,
    pub closes_at: Option<DateTime<Utc>>,
    pub is_closed: bool,
    pub is_quiz: bool,
    pub selected_option_ids: Vec<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voter_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correct_option_ids: Option<Vec<Uuid>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct PollVoterQuery {
    pub option_id: Option<Uuid>,
    pub after: Option<Uuid>,
}

#[derive(FromRow, Serialize, ToSchema)]
pub struct PollVoter {
    pub user_id: Uuid,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_file_id: Option<Uuid>,
}

#[derive(Serialize, ToSchema)]
pub struct PollVoterPage {
    pub voters: Vec<PollVoter>,
    pub next_after: Option<Uuid>,
}

#[derive(FromRow)]
struct PollRecord {
    definition: Json<PollInput>,
    version: i64,
    is_closed: bool,
    has_voted: bool,
}

#[derive(Clone, Copy)]
pub(crate) struct PollReader<'a> {
    pub message: &'a CanonicalMessage,
    pub user_id: Uuid,
}

fn bounded_text(value: &str, limit: usize) -> bool {
    value.encode_utf16().count() <= limit
}

fn normalize_options(options: &mut [PollOptionInput]) -> Result<(), AccountError> {
    let mut ids = HashSet::with_capacity(options.len());
    let mut labels = HashSet::with_capacity(options.len());
    for option in options {
        option.text = option.text.trim().to_owned();
        if option.text.is_empty() || !bounded_text(&option.text, OPTION_LIMIT) {
            return Err(AccountError::Validation("invalid poll option text"));
        }
        if !ids.insert(option.id) || !labels.insert(option.text.as_str()) {
            return Err(AccountError::Validation("duplicate poll option"));
        }
    }

    Ok(())
}

fn validate_selection(poll: &PollInput, selected: &[Uuid]) -> Result<(), AccountError> {
    let unique: HashSet<Uuid> = selected.iter().copied().collect();
    if unique.len() != selected.len() || (!poll.is_multiple_choice && selected.len() > 1) {
        return Err(AccountError::Validation("invalid poll selection"));
    }
    let known = selected.iter().all(|id| poll.options.iter().any(|option| option.id == *id));
    if !known {
        return Err(AccountError::Validation("unknown poll option"));
    }

    Ok(())
}

/// Normalize authored poll text and validate its complete option and rule set.
pub(super) fn normalize(poll: &mut PollInput) -> Result<(), AccountError> {
    poll.question = poll.question.trim().to_owned();
    if poll.question.is_empty() || !bounded_text(&poll.question, QUESTION_LIMIT) {
        return Err(AccountError::Validation("invalid poll question"));
    }
    if !(MIN_OPTIONS..=MAX_OPTIONS).contains(&poll.options.len()) {
        return Err(AccountError::Validation("a poll needs between two and twelve options"));
    }
    if poll.description.as_ref().is_some_and(|text| !bounded_text(text, DESCRIPTION_LIMIT)) {
        return Err(AccountError::Validation("invalid poll description"));
    }
    if poll.can_add_options && (poll.is_anonymous || poll.quiz.is_some()) {
        return Err(AccountError::Validation("this poll cannot accept added options"));
    }
    normalize_options(&mut poll.options)?;

    if let Some(quiz) = &poll.quiz {
        let explanation = quiz.explanation.as_ref();
        let is_too_long = explanation.is_some_and(|text| !bounded_text(text, EXPLANATION_LIMIT));
        if quiz.correct_option_ids.is_empty() || poll.can_revote || is_too_long {
            return Err(AccountError::Validation("invalid quiz rules or answers"));
        }
        validate_selection(poll, &quiz.correct_option_ids)?;
    }

    Ok(())
}

async fn validate_policy(
    connection: &mut PgConnection,
    conversation: &LockedConversation,
    poll: &PollInput,
) -> Result<(), AccountError> {
    if conversation.kind == "channel" && !poll.is_anonymous {
        return Err(AccountError::Validation("channel polls must be anonymous"));
    }
    if let Some(deadline) = poll.closes_at {
        let now: DateTime<Utc> =
            sqlx::query_scalar("SELECT clock_timestamp()").fetch_one(connection).await?;
        if deadline <= now {
            return Err(AccountError::Validation("poll deadline must be in the future"));
        }
    }

    Ok(())
}

pub(super) struct NewPoll<'a> {
    pub message_id: Uuid,
    pub conversation: &'a LockedConversation,
    pub poll: &'a PollInput,
}

/// Keep the quiz answer and voting rules in the private interaction record.
pub(super) async fn insert(
    connection: &mut PgConnection,
    input: NewPoll<'_>,
) -> Result<(), AccountError> {
    validate_policy(connection, input.conversation, input.poll).await?;

    let insert = sqlx::query(
        "INSERT INTO message_polls (message_id, definition, closes_at) VALUES ($1, $2, $3)",
    );
    let insert = insert.bind(input.message_id).bind(Json(input.poll)).bind(input.poll.closes_at);
    insert.execute(connection).await?;

    Ok(())
}

async fn read_poll(
    connection: &mut PgConnection,
    message_id: Uuid,
) -> Result<PollRecord, AccountError> {
    let query = sqlx::query_as(
        "SELECT definition, version, has_voted,
            (closed_at IS NOT NULL OR closes_at <= clock_timestamp()) IS TRUE AS is_closed
         FROM message_polls WHERE message_id = $1",
    );
    let record = query.bind(message_id).fetch_optional(connection).await?;

    record.ok_or(AccountError::NotFound)
}

async fn selected_options(
    connection: &mut PgConnection,
    reader: PollReader<'_>,
) -> Result<Vec<Uuid>, AccountError> {
    let query = sqlx::query_scalar(
        "SELECT option_ids FROM message_poll_votes WHERE message_id = $1 AND user_id = $2",
    );
    let query = query.bind(reader.message.id).bind(reader.user_id);
    let selected: Option<Vec<Uuid>> = query.fetch_optional(connection).await?;

    Ok(selected.unwrap_or_default())
}

async fn can_manage(
    connection: &mut PgConnection,
    reader: PollReader<'_>,
) -> Result<bool, AccountError> {
    if reader.message.author_id == reader.user_id {
        return Ok(true);
    }

    let query = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = $1
         AND user_id = $2 AND directory_active AND NOT is_banned AND role IN ('owner', 'admin'))",
    );
    let query = query.bind(reader.message.conversation_id).bind(reader.user_id);
    Ok(query.fetch_one(connection).await?)
}

async fn results(
    connection: &mut PgConnection,
    message_id: Uuid,
) -> Result<(i64, HashMap<Uuid, i64>), AccountError> {
    let voters =
        sqlx::query_scalar("SELECT count(*) FROM message_poll_votes WHERE message_id = $1");
    let voters = voters.bind(message_id).fetch_one(&mut *connection).await?;
    let counts = sqlx::query_as::<_, (Uuid, i64)>(
        "SELECT option_id, count(*) FROM message_poll_votes
         CROSS JOIN LATERAL unnest(option_ids) AS option_id
         WHERE message_id = $1 GROUP BY option_id",
    );
    let counts = counts.bind(message_id).fetch_all(connection).await?;

    Ok((voters, counts.into_iter().collect()))
}

/// Project only the results and quiz information that this reader may see.
pub(super) async fn view(
    connection: &mut PgConnection,
    reader: PollReader<'_>,
) -> Result<PollView, AccountError> {
    let poll = read_poll(connection, reader.message.id).await?;
    let may_close = can_manage(connection, reader).await?;
    let may_participate =
        access::can_interact(connection, reader.user_id, reader.message.conversation_id).await?;
    let is_author = reader.message.author_id == reader.user_id;
    let message_id = reader.message.id;
    let selected = selected_options(connection, reader).await?;
    let input = poll.definition.0;

    // Keep hidden totals and quiz answers absent on every read surface, including receipts.
    let is_result_visible = poll.is_closed || !input.hide_results_until_close;
    let (voter_count, counts) = if is_result_visible {
        let (total, counts) = results(connection, message_id).await?;
        (Some(total), counts)
    } else {
        (None, HashMap::new())
    };
    let is_quiz = input.quiz.is_some();
    let quiz = input.quiz.filter(|_| poll.is_closed || !selected.is_empty());
    let options = input.options.into_iter().map(|option| PollOptionView {
        id: option.id,
        text: option.text,
        votes: is_result_visible.then(|| counts.get(&option.id).copied().unwrap_or(0)),
    });

    Ok(PollView {
        question: input.question,
        description: input.description,
        options: options.collect(),
        version: poll.version.to_string(),
        is_anonymous: input.is_anonymous,
        is_multiple_choice: input.is_multiple_choice,
        can_revote: input.can_revote,
        can_add_options: input.can_add_options && !poll.is_closed && may_participate,
        can_vote: !poll.is_closed && may_participate,
        can_edit: is_author && !poll.has_voted && !poll.is_closed,
        can_close: may_close && !poll.is_closed,
        hide_results_until_close: input.hide_results_until_close,
        closes_at: input.closes_at,
        is_closed: poll.is_closed,
        is_quiz,
        selected_option_ids: selected,
        voter_count,
        correct_option_ids: quiz.as_ref().map(|quiz| quiz.correct_option_ids.clone()),
        explanation: quiz.and_then(|quiz| quiz.explanation),
    })
}

async fn lock_poll(
    connection: &mut PgConnection,
    message_id: Uuid,
) -> Result<PollRecord, AccountError> {
    let lock = sqlx::query("SELECT message_id FROM message_polls WHERE message_id = $1 FOR UPDATE");
    lock.bind(message_id).fetch_optional(&mut *connection).await?.ok_or(AccountError::NotFound)?;

    // Compute the deadline after waiting for the row, using the current database clock.
    read_poll(connection, message_id).await
}

async fn record_vote(
    connection: &mut PgConnection,
    reader: PollReader<'_>,
    mut selected: Vec<Uuid>,
) -> Result<(), AcceptanceError> {
    let message_id = reader.message.id;
    let user_id = reader.user_id;
    let poll = lock_poll(connection, message_id).await?;
    if poll.is_closed {
        return Err(AccountError::MessageConflict.into());
    }

    let input = &poll.definition.0;
    validate_selection(input, &selected)?;
    selected.sort_unstable();
    let previous = selected_options(connection, reader).await?;
    let can_revote = input.can_revote && input.quiz.is_none();
    if selected.is_empty() && !can_revote {
        return Err(AccountError::Validation("this poll requires a submitted selection").into());
    }
    if !previous.is_empty() && !can_revote && previous != selected {
        return Err(AccountError::MessageConflict.into());
    }

    // Replace the whole selection so concurrent requests can never add duplicate votes.
    if selected.is_empty() {
        let delete =
            sqlx::query("DELETE FROM message_poll_votes WHERE message_id = $1 AND user_id = $2");
        delete.bind(message_id).bind(user_id).execute(connection).await?;
        return Ok(());
    }

    let vote = sqlx::query(
        "INSERT INTO message_poll_votes (message_id, user_id, option_ids) VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id) DO UPDATE SET option_ids = EXCLUDED.option_ids",
    );
    let vote = vote.bind(message_id).bind(user_id).bind(selected);
    vote.execute(&mut *connection).await?;
    let mark_voted = sqlx::query("UPDATE message_polls SET has_voted = true WHERE message_id = $1");
    mark_voted.bind(message_id).execute(connection).await?;

    Ok(())
}

async fn update_definition(
    connection: &mut PgConnection,
    input: NewPoll<'_>,
) -> Result<(), AccountError> {
    validate_policy(connection, input.conversation, input.poll).await?;

    let update = sqlx::query(
        "UPDATE message_polls SET definition = $2, closes_at = $3, version = version + 1
         WHERE message_id = $1",
    );
    let update = update.bind(input.message_id).bind(Json(input.poll)).bind(input.poll.closes_at);
    update.execute(connection).await?;

    Ok(())
}

/// Apply a poll command with its conversation and participant locks already held.
pub(super) async fn apply(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
    message: &CanonicalMessage,
) -> Result<(), AcceptanceError> {
    let reader = PollReader {
        message,
        user_id: context.actor.user_id,
    };
    match &context.input.action {
        CommandAction::VotePoll {
            option_ids,
            ..
        } => {
            access::authorize_interaction(connection, context.actor, context.conversation).await?;
            record_vote(connection, reader, option_ids.clone()).await?;
        }
        CommandAction::EditPoll {
            expected_poll_version,
            poll,
            preserve_quiz,
            ..
        } => {
            edit_poll(
                connection,
                context,
                PollEdit {
                    message,
                    expected_poll_version,
                    poll,
                    should_preserve_quiz: preserve_quiz.unwrap_or_default(),
                },
            )
            .await?;
        }
        CommandAction::AddPollOption {
            expected_poll_version,
            option,
            ..
        } => {
            add_option(
                connection,
                context,
                OptionAddition {
                    message,
                    expected_poll_version,
                    option,
                },
            )
            .await?;
        }
        CommandAction::ClosePoll {
            ..
        } => {
            if !can_manage(connection, reader).await? {
                return Err(AccountError::NotFound.into());
            }
            lock_poll(connection, message.id).await?;
            close_poll(connection, message.id).await?;
        }
        _ => return Err(AccountError::Validation("expected a poll action").into()),
    }

    Ok(())
}

struct PollEdit<'a> {
    message: &'a CanonicalMessage,
    expected_poll_version: &'a str,
    poll: &'a PollInput,
    should_preserve_quiz: bool,
}

fn preserve_quiz(current: PollInput, updated: &mut PollInput) -> Result<(), AccountError> {
    // Validate public options before using the hidden answer so edits cannot reveal it.
    let retains_options = current
        .options
        .iter()
        .all(|existing| updated.options.iter().any(|option| option.id == existing.id));
    let retains_selection_mode = !current.is_multiple_choice || updated.is_multiple_choice;
    if updated.quiz.is_some() || !retains_options || !retains_selection_mode {
        return Err(AccountError::Validation("cannot preserve the quiz with these changes"));
    }
    let quiz = current.quiz.ok_or(AccountError::Validation("there is no quiz to preserve"))?;
    updated.quiz = Some(quiz);

    Ok(())
}

async fn edit_poll(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
    edit: PollEdit<'_>,
) -> Result<(), AcceptanceError> {
    if edit.message.author_id != context.actor.user_id {
        return Err(AccountError::NotFound.into());
    }
    access::authorize_send(connection, context.actor, context.conversation).await?;

    let current = lock_poll(connection, edit.message.id).await?;
    let version = history::parse_sequence(edit.expected_poll_version)?;
    if current.is_closed || current.has_voted || current.version != version {
        return Err(AccountError::MessageConflict.into());
    }

    let mut poll = edit.poll.clone();
    if edit.should_preserve_quiz {
        preserve_quiz(current.definition.0, &mut poll)?;
    }
    normalize(&mut poll)?;
    let update = NewPoll {
        message_id: edit.message.id,
        conversation: context.conversation,
        poll: &poll,
    };
    update_definition(connection, update).await?;

    Ok(())
}

struct OptionAddition<'a> {
    message: &'a CanonicalMessage,
    expected_poll_version: &'a str,
    option: &'a PollOptionInput,
}

async fn add_option(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
    addition: OptionAddition<'_>,
) -> Result<(), AcceptanceError> {
    access::authorize_interaction(connection, context.actor, context.conversation).await?;
    let current = lock_poll(connection, addition.message.id).await?;
    let version = history::parse_sequence(addition.expected_poll_version)?;
    if current.is_closed || current.version != version || !current.definition.can_add_options {
        return Err(AccountError::MessageConflict.into());
    }
    let mut poll = current.definition.0;
    poll.options.push(addition.option.clone());
    normalize(&mut poll)?;

    let update = NewPoll {
        message_id: addition.message.id,
        conversation: context.conversation,
        poll: &poll,
    };
    update_definition(connection, update).await?;

    Ok(())
}

/// Mark the poll closed without replacing its answers or reopening an existing close.
pub(crate) async fn close_poll(
    connection: &mut PgConnection,
    message_id: Uuid,
) -> Result<bool, AccountError> {
    let update = sqlx::query(
        "UPDATE message_polls SET closed_at = clock_timestamp(), version = version + 1
         WHERE message_id = $1 AND closed_at IS NULL",
    );
    let result = update.bind(message_id).execute(connection).await?;

    Ok(result.rows_affected() > 0)
}

/// Remove poll definitions and votes when their message becomes a tombstone.
pub(crate) async fn delete(
    connection: &mut PgConnection,
    message_id: Uuid,
) -> Result<(), sqlx::Error> {
    let delete = sqlx::query("DELETE FROM message_polls WHERE message_id = $1");
    delete.bind(message_id).execute(connection).await?;

    Ok(())
}

impl MessageService {
    /// Page voters only after the caller may see the public results of this poll.
    pub async fn poll_voters(
        &self,
        actor: Actor,
        message_id: Uuid,
        query: PollVoterQuery,
    ) -> Result<PollVoterPage, AccountError> {
        let mut snapshot = self.snapshot(&actor).await?;
        let mut visible = QueryBuilder::<Postgres>::new(
            "SELECT message.id FROM messages message WHERE message.id = ",
        );
        visible.push_bind(message_id);
        restrict_visible(&mut visible, actor.user_id);
        let found: Option<Uuid> =
            visible.build_query_scalar().fetch_optional(&mut *snapshot).await?;
        if found.is_none() {
            return Err(AccountError::NotFound);
        }
        let poll = read_poll(&mut snapshot, message_id).await?;
        let definition = &poll.definition.0;
        if definition.is_anonymous || (definition.hide_results_until_close && !poll.is_closed) {
            return Err(AccountError::NotFound);
        }
        let query_voters = sqlx::query_as::<_, PollVoter>(
            "SELECT vote.user_id, account.display_name,
                CASE WHEN NOT account.is_suspended AND account.deleted_at IS NULL
                     THEN account.avatar_file_id END AS avatar_file_id
             FROM message_poll_votes vote
             JOIN users account ON account.id = vote.user_id WHERE vote.message_id = $1
              AND ($2::uuid IS NULL OR $2 = ANY(vote.option_ids))
              AND ($3::uuid IS NULL OR vote.user_id > $3) ORDER BY vote.user_id LIMIT $4",
        );
        let query_voters = query_voters.bind(message_id).bind(query.option_id).bind(query.after);
        let query_voters = query_voters.bind((VOTER_PAGE_SIZE + 1) as i64);
        let mut voters = query_voters.fetch_all(&mut *snapshot).await?;
        let has_more = voters.len() > VOTER_PAGE_SIZE;
        voters.truncate(VOTER_PAGE_SIZE);
        let next_after = voters.last().filter(|_| has_more).map(|voter| voter.user_id);
        snapshot.commit().await?;

        Ok(PollVoterPage {
            voters,
            next_after,
        })
    }
}
