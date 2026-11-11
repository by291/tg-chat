use sqlx::PgPool;
use tg_chat::{
    accounts::{AccountError, AccountService, AccountSettings, Actor, Registration},
    messages::{Destination, MessageService, SendMessage, content::MessageContent},
};
use uuid::Uuid;

async fn register(accounts: &AccountService, username: &str) -> Actor {
    let grant = accounts
        .register(Registration {
            username: username.to_owned(),
            password: "a complete password phrase".to_owned(),
            display_name: username.to_owned(),
            device_name: "Browser".to_owned(),
        })
        .await
        .unwrap();

    accounts.authenticate(&grant.token).await.unwrap()
}

fn message(destination: Destination) -> SendMessage {
    SendMessage {
        reply: None,
        draft_version: None,
        attachments: Vec::new(),
        operation_id: Uuid::new_v4(),
        message_id: Uuid::new_v4(),
        destination,
        content: MessageContent {
            schema_version: 1,
            text: "Hello there".to_owned(),
            rich_text: None,
            custom_emoji: Vec::new(),
        },
    }
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn concurrent_replays_and_reciprocal_sends_share_one_conversation(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let bobby = register(&accounts, "bobby").await;
    let service = MessageService::new(accounts);
    let outgoing = message(Destination::Recipient {
        user_id: bobby.user_id,
    });
    let incoming = message(Destination::Recipient {
        user_id: alice.user_id,
    });
    let (first, replay, reciprocal) = tokio::join!(
        service.send(alice.clone(), outgoing.clone()),
        service.send(alice.clone(), outgoing.clone()),
        service.send(bobby.clone(), incoming),
    );
    let first = first.unwrap();
    let replay = replay.unwrap();
    let reciprocal = reciprocal.unwrap();
    assert_eq!(first.message.id, replay.message.id);
    assert_eq!(first.message.sequence, replay.message.sequence);
    assert_eq!(first.message.created_at, replay.message.created_at);
    assert_eq!(first.conversation.id, reciprocal.conversation.id);
    assert_ne!(first.message.sequence, reciprocal.message.sequence);

    let counts: (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM messages),
                (SELECT count(*) FROM conversation_members),
                (SELECT count(*) FROM personal_changes),
                (SELECT count(*) FROM sync_wakeups)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(counts, (2, 2, 4, 2));
    sqlx::query("DELETE FROM operation_receipts").execute(&pool).await.unwrap();
    assert_eq!(
        service.send(alice.clone(), outgoing.clone()).await.unwrap().message.id,
        first.message.id
    );

    let mut conflict = outgoing.clone();
    conflict.content.text = "Changed payload".to_owned();
    assert!(matches!(
        service.send(alice.clone(), conflict).await,
        Err(AccountError::MessageConflict)
    ));
    let mut reused = outgoing;
    reused.operation_id = Uuid::new_v4();
    assert!(matches!(service.send(alice, reused).await, Err(AccountError::MessageConflict)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn recipient_policy_and_blocks_reject_without_partial_effects(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let bobby = register(&accounts, "bobby").await;
    let service = MessageService::new(accounts);
    let outgoing = message(Destination::Recipient {
        user_id: bobby.user_id,
    });
    sqlx::query("UPDATE users SET direct_message_audience = 'contacts' WHERE id = $1")
        .bind(bobby.user_id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        service.send(alice.clone(), outgoing.clone()).await,
        Err(AccountError::ConversationUnavailable)
    ));
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM conversations").fetch_one(&pool).await.unwrap();
    assert_eq!(count, 0);
    let contact_insert = sqlx::query("INSERT INTO contacts (owner_id, target_id) VALUES ($1, $2)")
        .bind(bobby.user_id)
        .bind(alice.user_id);
    contact_insert.execute(&pool).await.unwrap();
    let accepted = service.send(alice.clone(), outgoing.clone()).await.unwrap();
    let block_insert = sqlx::query("INSERT INTO blocks (owner_id, target_id) VALUES ($1, $2)")
        .bind(bobby.user_id)
        .bind(alice.user_id);
    block_insert.execute(&pool).await.unwrap();
    // Reconciliation remains possible after a later privacy change; new messages do not.
    assert_eq!(
        service.send(alice.clone(), outgoing).await.unwrap().message.id,
        accepted.message.id
    );
    assert!(matches!(
        service
            .send(
                alice.clone(),
                message(Destination::Recipient {
                    user_id: bobby.user_id,
                })
            )
            .await,
        Err(AccountError::ConversationUnavailable)
    ));
    let saved = service.ensure_saved(alice.clone()).await.unwrap();
    assert_eq!(saved.id, service.ensure_saved(alice.clone()).await.unwrap().id);
    let saved_message = service.send(alice, message(Destination::Saved)).await.unwrap();
    assert_eq!(saved_message.conversation.id, saved.id);
    assert_eq!(saved_message.conversation.unread_count, "0");
    assert!(matches!(
        service
            .send(
                bobby,
                message(Destination::Conversation {
                    conversation_id: saved.id,
                })
            )
            .await,
        Err(AccountError::NotFound)
    ));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn concurrent_admission_respects_both_directory_capacities(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let bobby = register(&accounts, "bobby").await;
    let carol = register(&accounts, "carol").await;
    // Fixture members exercise the same locked capacity count without hashing 199 passwords.
    sqlx::query(
        "WITH peers AS (
            INSERT INTO users (id, username, password_hash, display_name)
            SELECT gen_random_uuid(), 'peer_' || number, 'unused', 'Peer'
            FROM generate_series(1, 199) AS number RETURNING id
         ), chats AS (
            INSERT INTO conversations (id, kind, participant_low, participant_high)
            SELECT gen_random_uuid(), 'direct', least($1, id), greatest($1, id) FROM peers
            RETURNING id
         ) INSERT INTO conversation_members (conversation_id, user_id)
           SELECT id, $1 FROM chats",
    )
    .bind(alice.user_id)
    .execute(&pool)
    .await
    .unwrap();
    let service = MessageService::new(accounts);
    let (first, second) = tokio::join!(
        service.send(
            bobby,
            message(Destination::Recipient {
                user_id: alice.user_id
            })
        ),
        service.send(
            carol,
            message(Destination::Recipient {
                user_id: alice.user_id
            })
        ),
    );
    assert_ne!(first.is_ok(), second.is_ok());
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM messages").fetch_one(&pool).await.unwrap();
    assert_eq!(count, 1);
    service.ensure_saved(alice).await.unwrap();
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn rejected_policy_or_failed_feed_rolls_back_the_entire_send(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let bobby = register(&accounts, "bobby").await;
    let service = MessageService::new(accounts);
    let outgoing = message(Destination::Recipient {
        user_id: bobby.user_id,
    });
    sqlx::query("UPDATE users SET direct_message_audience = 'nobody' WHERE id = $1")
        .bind(bobby.user_id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        service.send(alice.clone(), outgoing.clone()).await,
        Err(AccountError::ConversationUnavailable)
    ));
    sqlx::query(
        "UPDATE users SET direct_message_audience = 'everyone', is_suspended = true WHERE id = $1",
    )
    .bind(bobby.user_id)
    .execute(&pool)
    .await
    .unwrap();
    assert!(matches!(
        service.send(alice.clone(), outgoing.clone()).await,
        Err(AccountError::ConversationUnavailable)
    ));
    sqlx::query("UPDATE users SET is_suspended = false WHERE id = $1")
        .bind(bobby.user_id)
        .execute(&pool)
        .await
        .unwrap();

    // A database fault after message insertion must not leave a receipt or advance either feed.
    sqlx::raw_sql(
        "CREATE FUNCTION reject_test_feed() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN RAISE EXCEPTION 'injected feed failure'; END; $$;
         CREATE TRIGGER reject_test_feed BEFORE INSERT ON personal_changes
         FOR EACH ROW EXECUTE FUNCTION reject_test_feed();",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(matches!(
        service.send(alice.clone(), outgoing.clone()).await,
        Err(AccountError::Unavailable)
    ));
    let effects: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM conversations),
                (SELECT count(*) FROM messages),
                (SELECT count(*) FROM message_identities),
                (SELECT count(*) FROM operation_receipts),
                (SELECT count(*) FROM sync_wakeups),
                (SELECT sum(position)::bigint FROM sync_heads)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(effects, (0, 0, 0, 0, 0, 0));
    sqlx::query("DROP TRIGGER reject_test_feed ON personal_changes").execute(&pool).await.unwrap();
    service.send(alice, outgoing).await.unwrap();
}
