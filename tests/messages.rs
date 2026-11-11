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
        body: None,
        disable_link_preview: None,
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

fn typed_message(destination: Destination, body: serde_json::Value) -> SendMessage {
    let mut request = serde_json::to_value(message(destination)).unwrap();
    request["content"]["text"] = serde_json::json!("");
    request["body"] = body;
    serde_json::from_value(request).expect("the typed request should be accepted by the API model")
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn legacy_text_replay_keeps_its_identity_with_typed_bodies(pool: PgPool) {
    use sha2::{Digest, Sha256};

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let service = MessageService::new(accounts);
    let request = message(Destination::Saved);
    let legacy_payload = format!(
        concat!(
            r#"{{"operation_id":"{}","message_id":"{}","destination":{{"kind":"saved"}},"#,
            r#""content":{{"schema_version":1,"text":"Hello there","rich_text":null,"#,
            r#""custom_emoji":[]}}}}"#
        ),
        request.operation_id, request.message_id,
    );
    let legacy_hash = Sha256::digest(legacy_payload.as_bytes());
    let original = service.send(alice.clone(), request.clone()).await.unwrap();
    let update = sqlx::query("UPDATE message_identities SET payload_hash = $1 WHERE id = $2")
        .bind(legacy_hash.as_slice())
        .bind(original.message.id);
    update.execute(&pool).await.unwrap();

    let replay = service.send(alice, request).await.unwrap();
    assert_eq!(replay.message.id, original.message.id);
    assert_eq!(replay.message.created_at, original.message.created_at);
    assert!(serde_json::to_value(replay.message).unwrap().get("body").is_none());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn sticker_and_contact_bodies_round_trip_through_history_and_sync(pool: PgPool) {
    use serde_json::json;
    use tg_chat::{messages::HistoryQuery, sync::SyncQuery};

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let bobby = register(&accounts, "bobby").await;
    let private_fields = sqlx::query(
        "UPDATE users SET phone = '+1 555 0199', verified_email = 'private@example.test'
         WHERE id = $1",
    )
    .bind(bobby.user_id);
    private_fields.execute(&pool).await.unwrap();
    let service = MessageService::new(accounts);
    let initial = service.bootstrap(bobby.clone()).await.unwrap();
    let destination = Destination::Recipient {
        user_id: bobby.user_id,
    };
    let sticker_body = json!({
        "kind": "sticker",
        "sticker_id": "UtyaDuck-AgAD8gADVp29Cg",
    });
    let contact_body = json!({
        "kind": "contact",
        "display_name": "Emergency contact",
        "account_id": bobby.user_id,
        "phone": "+1 555 0100",
    });
    let sticker_request = typed_message(destination.clone(), sticker_body.clone());
    let contact_request = typed_message(destination, contact_body.clone());

    let sticker = service.send(alice.clone(), sticker_request).await.unwrap();
    assert_eq!(sticker.conversation.summary_text, "Sticker");
    let contact = service.send(alice.clone(), contact_request.clone()).await.unwrap();
    assert_eq!(contact.conversation.summary_text, "Contact: Emergency contact");
    assert_eq!(serde_json::to_value(&sticker.message).unwrap()["body"], sticker_body);
    assert_eq!(serde_json::to_value(&contact.message).unwrap()["body"], contact_body);
    let mut changed = serde_json::to_value(contact_request).unwrap();
    changed["body"]["phone"] = json!("+1 555 0101");
    let changed = serde_json::from_value(changed).unwrap();
    assert!(matches!(service.send(alice, changed).await, Err(AccountError::MessageConflict)));

    let history = service
        .history(
            bobby.clone(),
            HistoryQuery {
                conversation_id: sticker.conversation.id,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(serde_json::to_value(&history.messages[0]).unwrap()["body"], sticker_body);
    assert_eq!(serde_json::to_value(&history.messages[1]).unwrap()["body"], contact_body);

    let sync = service
        .sync(
            bobby,
            SyncQuery {
                cursor: initial.cursor,
                limit: None,
            },
        )
        .await
        .unwrap();
    let changes: Vec<_> = sync.groups.iter().filter_map(|group| group.message.as_ref()).collect();
    assert_eq!(serde_json::to_value(changes[0]).unwrap()["body"], sticker_body);
    assert_eq!(serde_json::to_value(changes[1]).unwrap()["body"], contact_body);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn unknown_stickers_and_inaccessible_contact_accounts_are_rejected(pool: PgPool) {
    use serde_json::json;

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let bobby = register(&accounts, "bobby").await;
    let suspend =
        sqlx::query("UPDATE users SET is_suspended = true WHERE id = $1").bind(bobby.user_id);
    suspend.execute(&pool).await.unwrap();
    let service = MessageService::new(accounts);

    let sticker = typed_message(
        Destination::Saved,
        json!({ "kind": "sticker", "sticker_id": "not-in-the-catalogue" }),
    );
    assert!(matches!(service.send(alice.clone(), sticker).await, Err(AccountError::Validation(_))));
    let contact = typed_message(
        Destination::Saved,
        json!({ "kind": "contact", "display_name": "Bobby", "account_id": bobby.user_id }),
    );
    assert!(matches!(service.send(alice, contact).await, Err(AccountError::NotFound)));
}
