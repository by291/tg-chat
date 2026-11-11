#[allow(dead_code)]
mod support;

use serde_json::{Value, json};
use sqlx::PgPool;
use tg_chat::{
    accounts::{AccountError, Actor},
    messages::{MessageService, SendMessage},
};
use uuid::Uuid;

use support::messaging::{command, fixture, send_input};

struct PollFixture {
    conversation: Uuid,
    message: Uuid,
    options: [Uuid; 2],
}

async fn send_poll(service: &MessageService, sender: Actor, recipient: Uuid) -> PollFixture {
    let options = [Uuid::new_v4(), Uuid::new_v4()];
    let mut input = serde_json::to_value(send_input(recipient)).unwrap();
    input["body"] = json!({
        "kind": "poll",
        "question": "Which trail should we take?",
        "options": [
            {"id": options[0], "text": "North"},
            {"id": options[1], "text": "South"},
        ],
        "is_anonymous": true,
        "can_revote": true,
        "hide_results_until_close": true,
    });
    let input: SendMessage = serde_json::from_value(input).unwrap();
    let sent = service.send(sender, input).await.unwrap();

    PollFixture {
        conversation: sent.conversation.id,
        message: sent.message.id,
        options,
    }
}

fn vote(poll: &PollFixture, option: Uuid) -> tg_chat::messages::MessageCommand {
    command(
        poll.conversation,
        json!({
            "kind": "vote_poll",
            "message_id": poll.message,
            "option_ids": [option],
        }),
    )
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn concurrent_votes_replace_one_account_selection(pool: PgPool) {
    let (service, sender, reader) = fixture(pool).await;
    let poll = send_poll(&service, sender.clone(), reader.user_id).await;

    let (first, second) = tokio::join!(
        service.command(reader.clone(), vote(&poll, poll.options[0])),
        service.command(reader.clone(), vote(&poll, poll.options[1])),
    );
    first.unwrap();
    second.unwrap();

    let own_view = service.message(reader, poll.message).await.unwrap();
    let own_view = serde_json::to_value(own_view).unwrap();
    let own_selection = own_view["body"]["selected_option_ids"].as_array().unwrap();
    assert_eq!(own_selection.len(), 1);
    assert_eq!(own_view["body"].get("voter_count"), None);
    assert_eq!(own_view["body"]["options"][0].get("votes"), None);

    let close =
        command(poll.conversation, json!({"kind": "close_poll", "message_id": poll.message}));
    let closed = service.command(sender, close).await.unwrap();
    let closed = serde_json::to_value(closed.message.unwrap()).unwrap();
    let body = &closed["body"];
    assert_eq!(body["voter_count"], 1);
    let total: u64 = body["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|option| option["votes"].as_u64().unwrap())
        .sum();
    assert_eq!(total, 1);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn quiz_answers_follow_reader_visibility(pool: PgPool) {
    let (service, sender, reader) = fixture(pool).await;
    let options = [Uuid::new_v4(), Uuid::new_v4()];
    let mut input = serde_json::to_value(send_input(reader.user_id)).unwrap();
    input["body"] = json!({
        "kind": "poll",
        "question": "Which answer is correct?",
        "options": [
            {"id": options[0], "text": "First"},
            {"id": options[1], "text": "Second"},
        ],
        "is_anonymous": true,
        "quiz": {
            "correct_option_ids": [options[1]],
            "explanation": "The second answer is correct.",
        },
    });
    let input = serde_json::from_value(input).unwrap();
    let sent = service.send(sender.clone(), input).await.unwrap();
    let poll = PollFixture {
        conversation: sent.conversation.id,
        message: sent.message.id,
        options,
    };

    let before = service.message(reader.clone(), poll.message).await.unwrap();
    let before = serde_json::to_value(before).unwrap();
    assert_eq!(before["body"].get("correct_option_ids"), None);
    assert_eq!(before["body"].get("explanation"), None);

    let edit = command(
        poll.conversation,
        json!({
            "kind": "edit_poll",
            "message_id": poll.message,
            "expected_poll_version": before["body"]["version"],
            "preserve_quiz": true,
            "poll": {
                "question": "Which trail is correct?",
                "is_anonymous": true,
                "options": [
                    {"id": options[0], "text": "First trail"},
                    {"id": options[1], "text": "Second trail"},
                ],
            },
        }),
    );
    let edited = service.command(sender, edit).await.unwrap();
    let edited = serde_json::to_value(edited.message.unwrap()).unwrap();
    assert_eq!(edited["body"]["question"], "Which trail is correct?");
    assert!(edited["body"].get("correct_option_ids").is_none());
    assert!(edited["body"].get("explanation").is_none());

    let selection = vote(&poll, options[0]);
    let accepted = service.command(reader.clone(), selection.clone()).await.unwrap();
    let replayed = service.command(reader.clone(), selection).await.unwrap();
    for receipt in [accepted, replayed] {
        let message = serde_json::to_value(receipt.message.unwrap()).unwrap();
        assert_eq!(message["body"]["correct_option_ids"], json!([options[1]]));
        assert_eq!(message["body"]["explanation"], "The second answer is correct.");
    }
    assert!(matches!(
        service.command(reader, vote(&poll, options[1])).await,
        Err(AccountError::MessageConflict)
    ));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn late_votes_fail_when_the_database_deadline_passes(pool: PgPool) {
    let (service, sender, reader) = fixture(pool.clone()).await;
    let poll = send_poll(&service, sender, reader.user_id).await;
    let mut held = pool.begin().await.unwrap();
    let lock = sqlx::query("SELECT message_id FROM message_polls WHERE message_id = $1 FOR UPDATE");
    lock.bind(poll.message).execute(&mut *held).await.unwrap();
    let pending = vote(&poll, poll.options[0]);
    let vote_service = service.clone();
    let voter = reader.clone();
    let submitting = tokio::spawn(async move { vote_service.command(voter, pending).await });

    // Wait for the vote to reach the held poll row before crossing the deadline.
    let waiting_query = "SELECT EXISTS (SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE 'SELECT message_id FROM message_polls%')";
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !sqlx::query_scalar::<_, bool>(waiting_query).fetch_one(&pool).await.unwrap() {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("vote waits on the poll row");
    let deadline =
        sqlx::query("UPDATE message_polls SET closes_at = clock_timestamp() WHERE message_id = $1");
    deadline.bind(poll.message).execute(&mut *held).await.unwrap();
    held.commit().await.unwrap();

    let outcome = submitting.await.unwrap();
    assert!(matches!(outcome, Err(AccountError::MessageConflict)));
    let message = service.message(reader, poll.message).await.unwrap();
    let view: Value = serde_json::to_value(message).unwrap();
    assert_eq!(view["body"]["is_closed"], true);
    assert_eq!(view["body"]["voter_count"], 0);
}

struct ChecklistFixture {
    conversation: Uuid,
    message: Uuid,
    tasks: [Uuid; 2],
}

async fn send_checklist(
    service: &MessageService,
    author: Actor,
    destination: Value,
) -> ChecklistFixture {
    let tasks = [Uuid::new_v4(), Uuid::new_v4()];
    let input = serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "message_id": Uuid::new_v4(),
        "destination": destination,
        "content": {"schema_version": 1, "text": "", "custom_emoji": []},
        "body": {
            "kind": "checklist",
            "title": "Trail equipment",
            "tasks": [
                {"id": tasks[0], "text": "Bring a map"},
                {"id": tasks[1], "text": "Pack water"},
            ],
            "can_others_complete": true,
            "can_others_append": true,
        },
    }))
    .unwrap();
    let sent = service.send(author, input).await.unwrap();

    ChecklistFixture {
        conversation: sent.conversation.id,
        message: sent.message.id,
        tasks,
    }
}

fn complete_task(checklist: &ChecklistFixture, task_id: Uuid) -> tg_chat::messages::MessageCommand {
    command(
        checklist.conversation,
        json!({
            "kind": "set_checklist_task",
            "message_id": checklist.message,
            "task_id": task_id,
            "expected_task_version": "1",
            "is_complete": true,
        }),
    )
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn different_checklist_tasks_can_complete_from_the_same_list_version(pool: PgPool) {
    let (service, author, reader) = fixture(pool).await;
    let destination = json!({"kind": "recipient", "user_id": reader.user_id});
    let checklist = send_checklist(&service, author, destination).await;
    let first = complete_task(&checklist, checklist.tasks[0]);
    let second = complete_task(&checklist, checklist.tasks[1]);

    let (first_result, second_result) = tokio::join!(
        service.command(reader.clone(), first.clone()),
        service.command(reader.clone(), second),
    );
    first_result.unwrap();
    second_result.unwrap();
    service.command(reader.clone(), first).await.unwrap();

    let current = service.message(reader, checklist.message).await.unwrap();
    let current = serde_json::to_value(current).unwrap();
    assert_eq!(current["body"]["list_version"], "1");
    for task in current["body"]["tasks"].as_array().unwrap() {
        assert_eq!(task["is_complete"], true);
        assert_eq!(task["version"], "2");
    }
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn task_completion_conflicts_with_a_concurrent_removal(pool: PgPool) {
    let (service, author, reader) = fixture(pool).await;
    let destination = json!({"kind": "recipient", "user_id": reader.user_id});
    let checklist = send_checklist(&service, author.clone(), destination).await;
    let pending_completion = complete_task(&checklist, checklist.tasks[0]);
    let remove_task = command(
        checklist.conversation,
        json!({
            "kind": "edit_checklist",
            "message_id": checklist.message,
            "expected_list_version": "1",
            "checklist": {
                "title": "Trail equipment",
                "tasks": [{"id": checklist.tasks[1], "text": "Pack water"}],
                "can_others_complete": true,
            },
        }),
    );
    service.command(author, remove_task).await.unwrap();

    let rejected = service.command(reader, pending_completion).await;
    assert!(matches!(rejected, Err(AccountError::MessageConflict)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn permission_revocation_blocks_pending_checklist_completion(pool: PgPool) {
    let (service, author, reader) = fixture(pool).await;
    let destination = json!({"kind": "recipient", "user_id": reader.user_id});
    let checklist = send_checklist(&service, author.clone(), destination).await;
    let pending_completion = complete_task(&checklist, checklist.tasks[0]);
    let revoke = command(
        checklist.conversation,
        json!({
            "kind": "edit_checklist",
            "message_id": checklist.message,
            "expected_list_version": "1",
            "checklist": {
                "title": "Trail equipment",
                "tasks": [
                    {"id": checklist.tasks[0], "text": "Bring a map"},
                    {"id": checklist.tasks[1], "text": "Pack water"},
                ],
                "can_others_complete": false,
            },
        }),
    );
    service.command(author, revoke).await.unwrap();

    let rejected = service.command(reader, pending_completion).await;
    assert!(matches!(rejected, Err(AccountError::MessageConflict)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn channel_subscribers_cannot_read_other_completers(pool: PgPool) {
    use tg_chat::accounts::{AccountService, AccountSettings};

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let first = support::account(&accounts, "first").await;
    let second = support::account(&accounts, "second").await;
    let service = MessageService::new(accounts);
    let channel = Uuid::new_v4();
    let create = sqlx::query(
        "INSERT INTO conversations (id, kind, owner_id, title)
         VALUES ($1, 'channel', $2, 'Hiking club')",
    );
    create.bind(channel).bind(owner.user_id).execute(&pool).await.unwrap();
    let admit = sqlx::query(
        "INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'member')",
    );
    let admit = admit.bind(channel).bind(owner.user_id);
    let admit = admit.bind(first.user_id).bind(second.user_id);
    admit.execute(&pool).await.unwrap();

    let destination = json!({"kind": "conversation", "conversation_id": channel});
    let checklist = send_checklist(&service, owner.clone(), destination).await;
    let completion = complete_task(&checklist, checklist.tasks[0]);
    let receipt = service.command(first.clone(), completion).await.unwrap();
    let receipt = serde_json::to_value(receipt.message.unwrap()).unwrap();
    assert_eq!(receipt["body"]["tasks"][0]["completed_by"]["user_id"], json!(first.user_id));

    let subscriber = service.message(second, checklist.message).await.unwrap();
    let subscriber = serde_json::to_value(subscriber).unwrap();
    assert_eq!(subscriber["body"]["tasks"][0]["is_complete"], true);
    assert!(subscriber["body"]["tasks"][0].get("completed_by").is_none());

    let manager = service.message(owner, checklist.message).await.unwrap();
    let manager = serde_json::to_value(manager).unwrap();
    assert_eq!(manager["body"]["tasks"][0]["completed_by"]["user_id"], json!(first.user_id));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn checklist_structure_edits_preserve_completion_for_retained_tasks(pool: PgPool) {
    let (service, author, reader) = fixture(pool).await;
    let destination = json!({"kind": "recipient", "user_id": reader.user_id});
    let checklist = send_checklist(&service, author.clone(), destination).await;
    let complete = complete_task(&checklist, checklist.tasks[0]);
    service.command(reader.clone(), complete).await.unwrap();

    let append_id = Uuid::new_v4();
    let append = command(
        checklist.conversation,
        json!({
            "kind": "append_checklist_tasks",
            "message_id": checklist.message,
            "expected_list_version": "1",
            "tasks": [{"id": append_id, "text": "Pack a light"}],
        }),
    );
    service.command(reader.clone(), append).await.unwrap();

    let edit = command(
        checklist.conversation,
        json!({
            "kind": "edit_checklist",
            "message_id": checklist.message,
            "expected_list_version": "2",
            "checklist": {
                "title": "Final trail equipment",
                "tasks": [
                    {"id": append_id, "text": "Pack a light"},
                    {"id": checklist.tasks[0], "text": "Bring a trail map"},
                ],
            },
        }),
    );
    let receipt = service.command(author, edit).await.unwrap();
    let message = serde_json::to_value(receipt.message.unwrap()).unwrap();
    let body = &message["body"];
    assert_eq!(body["list_version"], "3");
    assert_eq!(body["tasks"].as_array().unwrap().len(), 2);
    assert_eq!(body["tasks"][0]["id"], json!(append_id));
    assert_eq!(body["tasks"][1]["text"], "Bring a trail map");
    assert_eq!(body["tasks"][1]["version"], "2");
    assert_eq!(body["tasks"][1]["completed_by"]["user_id"], json!(reader.user_id));
}
