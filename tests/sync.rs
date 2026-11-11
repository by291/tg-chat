use sqlx::PgPool;
use tg_chat::{
    accounts::{AccountError, AccountService, AccountSettings, Actor, Registration},
    messages::{Destination, HistoryQuery, MessageService, SendMessage, content::MessageContent},
    sync::SyncQuery,
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

fn outgoing(destination: Destination) -> SendMessage {
    SendMessage {
        body: None,
        reply: None,
        draft_version: None,
        attachments: Vec::new(),
        operation_id: Uuid::new_v4(),
        message_id: Uuid::new_v4(),
        destination,
        content: MessageContent {
            schema_version: 1,
            text: "Snapshot message".to_owned(),
            rich_text: None,
            custom_emoji: Vec::new(),
        },
    }
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn bounded_sync_and_keyset_history_preserve_authorization_and_complete_groups(pool: PgPool) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let bobby = register(&accounts, "bobby").await;
    let carol = register(&accounts, "carol").await;
    let service = MessageService::new(accounts);
    let initial = service.bootstrap(alice.clone()).await.unwrap();
    assert_eq!(initial.conversations.len(), 1);
    let mut receipts = Vec::new();
    for _ in 0..3 {
        receipts.push(
            service
                .send(
                    bobby.clone(),
                    outgoing(Destination::Recipient {
                        user_id: alice.user_id,
                    }),
                )
                .await
                .unwrap(),
        );
    }
    let page = service
        .sync(
            alice.clone(),
            SyncQuery {
                cursor: initial.cursor.clone(),
                limit: Some(2),
            },
        )
        .await
        .unwrap();
    assert_eq!(page.groups.len(), 2);
    assert!(page.has_more);
    assert_eq!(page.groups[0].conversation.as_ref().unwrap().last_sequence, "3");
    assert_eq!(page.groups[0].message.as_ref().unwrap().id, receipts[0].message.id);
    let next = service
        .sync(
            alice.clone(),
            SyncQuery {
                cursor: page.cursor,
                limit: Some(2),
            },
        )
        .await
        .unwrap();
    assert_eq!(next.groups.len(), 1);
    assert!(!next.has_more);
    assert_eq!(next.cursor, next.observation_cursor);
    assert!(matches!(
        service
            .sync(
                bobby.clone(),
                SyncQuery {
                    cursor: initial.cursor,
                    limit: None,
                }
            )
            .await,
        Err(AccountError::SyncResetRequired)
    ));
    assert!(matches!(
        service
            .sync(
                alice.clone(),
                SyncQuery {
                    cursor: "malformed".to_owned(),
                    limit: None,
                }
            )
            .await,
        Err(AccountError::SyncResetRequired)
    ));

    let conversation_id = receipts[0].conversation.id;
    let history = service
        .history(
            alice.clone(),
            HistoryQuery {
                conversation_id,
                limit: Some(2),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(history.messages.len(), 2);
    assert_eq!(history.messages[0].sequence, "2");
    assert_eq!(history.preceding_message.unwrap().sequence, "1");
    assert!(history.has_older);
    let older = service
        .history(
            alice.clone(),
            HistoryQuery {
                conversation_id,
                before: Some("2".to_owned()),
                limit: Some(2),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(older.messages[0].sequence, "1");
    assert!(!older.has_older);
    let after = service
        .history(
            alice.clone(),
            HistoryQuery {
                conversation_id,
                after: Some("1".to_owned()),
                limit: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(after.messages[0].sequence, "2");
    assert!(after.has_newer);
    assert!(matches!(
        service.message(carol.clone(), receipts[0].message.id).await,
        Err(AccountError::NotFound)
    ));
    assert!(matches!(
        service
            .history(
                carol,
                HistoryQuery {
                    conversation_id,
                    ..Default::default()
                }
            )
            .await,
        Err(AccountError::NotFound)
    ));
    assert!(matches!(service.message(alice, Uuid::new_v4()).await, Err(AccountError::NotFound)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn stalled_feed_allocation_cannot_be_skipped_by_another_commit(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let bobby = register(&accounts, "bobby").await;
    let service = MessageService::new(accounts);
    let initial = service.bootstrap(alice.clone()).await.unwrap();
    let saved_id = initial.conversations[0].id;
    let mut stalled = pool.begin().await.unwrap();
    let position: i64 = sqlx::query_scalar(
        "UPDATE sync_heads SET position = position + 1 WHERE user_id = $1 RETURNING position",
    )
    .bind(alice.user_id)
    .fetch_one(&mut *stalled)
    .await
    .unwrap();
    let change_insert = sqlx::query(
        "INSERT INTO personal_changes (user_id, position, conversation_id) VALUES ($1, $2, $3)",
    )
    .bind(alice.user_id)
    .bind(position)
    .bind(saved_id);
    change_insert.execute(&mut *stalled).await.unwrap();
    let writer = service.clone();
    let recipient = alice.user_id;
    let send = tokio::spawn(async move {
        writer
            .send(
                bobby,
                outgoing(Destination::Recipient {
                    user_id: recipient,
                }),
            )
            .await
    });
    let current = service
        .sync(
            alice.clone(),
            SyncQuery {
                cursor: initial.cursor.clone(),
                limit: None,
            },
        )
        .await
        .unwrap();
    assert!(current.groups.is_empty());
    assert_eq!(current.cursor, initial.cursor);
    stalled.commit().await.unwrap();
    send.await.unwrap().unwrap();
    let committed = service
        .sync(
            alice.clone(),
            SyncQuery {
                cursor: initial.cursor,
                limit: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(committed.groups.len(), 2);
    let bootstrap = service.bootstrap(alice).await.unwrap();
    assert_eq!(bootstrap.cursor, committed.observation_cursor);
    assert_eq!(bootstrap.conversations.len(), 2);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn cursor_rejects_future_and_foreign_deployment_positions_and_oversized_pages(pool: PgPool) {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

    let accounts = AccountService::new(pool, AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let service = MessageService::new(accounts);
    let bootstrap = service.bootstrap(alice.clone()).await.unwrap();
    let decoded = URL_SAFE_NO_PAD.decode(&bootstrap.cursor).unwrap();
    let cursor: serde_json::Value = serde_json::from_slice(&decoded).unwrap();
    let mut future = cursor.clone();
    future["position"] = serde_json::json!("999999999999");
    let mut foreign = cursor;
    foreign["deployment_id"] = serde_json::json!(Uuid::new_v4());
    for invalid in [future, foreign] {
        let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&invalid).unwrap());
        let result = service
            .sync(
                alice.clone(),
                SyncQuery {
                    cursor: encoded,
                    limit: None,
                },
            )
            .await;
        assert!(matches!(result, Err(AccountError::SyncResetRequired)));
    }
    let result = service
        .sync(
            alice,
            SyncQuery {
                cursor: bootstrap.cursor,
                limit: Some(101),
            },
        )
        .await;
    assert!(matches!(result, Err(AccountError::Validation(_))));
}
