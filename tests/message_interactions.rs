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
    let sent = service.send(sender, input).await.unwrap();
    let poll = PollFixture {
        conversation: sent.conversation.id,
        message: sent.message.id,
        options,
    };

    let before = service.message(reader.clone(), poll.message).await.unwrap();
    let before = serde_json::to_value(before).unwrap();
    assert_eq!(before["body"].get("correct_option_ids"), None);
    assert_eq!(before["body"].get("explanation"), None);

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
