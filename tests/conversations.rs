#[allow(dead_code)]
mod support;

use serde_json::json;
use sqlx::PgPool;
use tg_chat::{
    accounts::{AccountService, AccountSettings, Actor},
    messages::{HistoryQuery, MessageService, SendMessage},
};
use uuid::Uuid;

async fn community(pool: &PgPool, owner: &Actor, kind: &str) -> Uuid {
    let id = Uuid::new_v4();
    let insert = sqlx::query(
        "INSERT INTO conversations (id, kind, owner_id, title) VALUES ($1, $2, $3, 'Reading club')",
    )
    .bind(id)
    .bind(kind)
    .bind(owner.user_id);
    insert.execute(pool).await.unwrap();
    let member = sqlx::query(
        "INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, 'owner')",
    )
    .bind(id)
    .bind(owner.user_id);
    member.execute(pool).await.unwrap();
    id
}

fn message(conversation_id: Uuid) -> SendMessage {
    serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "message_id": Uuid::new_v4(),
        "destination": {"kind": "conversation", "conversation_id": conversation_id},
        "content": {"schema_version": 1, "text": "Retained history", "custom_emoji": []}
    }))
    .unwrap()
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn group_history_requires_current_membership_and_respects_quarantine(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let member = support::account(&accounts, "member").await;
    let service = MessageService::new(accounts);
    let id = community(&pool, &owner, "group").await;
    let sent = service.send(owner.clone(), message(id)).await.unwrap();
    assert!(service.message(member.clone(), sent.message.id).await.is_err());

    let admit =
        sqlx::query("INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)")
            .bind(id)
            .bind(member.user_id);
    admit.execute(&pool).await.unwrap();
    let history = service
        .history(
            member.clone(),
            HistoryQuery {
                conversation_id: id,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(history.messages[0].id, sent.message.id);

    let quarantine =
        sqlx::query("UPDATE conversations SET is_quarantined = true WHERE id = $1").bind(id);
    quarantine.execute(&pool).await.unwrap();
    assert!(service.message(member.clone(), sent.message.id).await.is_err());
    assert!(service.send(owner, message(id)).await.is_err());
    let bootstrap = service.bootstrap(member).await.unwrap();
    assert!(!bootstrap.conversations.iter().any(|entry| entry.id == id));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn channel_subscribers_read_but_cannot_publish_and_group_mutes_block_posting(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let member = support::account(&accounts, "member").await;
    let service = MessageService::new(accounts);
    for kind in ["channel", "group"] {
        let id = community(&pool, &owner, kind).await;
        let admit = sqlx::query(
            "INSERT INTO conversation_members (conversation_id, user_id, posting_muted_until)
             VALUES ($1, $2, now() + interval '1 day')",
        )
        .bind(id)
        .bind(member.user_id);
        admit.execute(&pool).await.unwrap();
        let sent = service.send(owner.clone(), message(id)).await.unwrap();
        assert!(service.message(member.clone(), sent.message.id).await.is_ok());
        assert!(service.send(member.clone(), message(id)).await.is_err());
        if kind == "channel" {
            assert_eq!(sent.message.author_name, "Reading club");
        }
    }
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn community_moderation_requires_a_manager_without_granting_author_edit_rights(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let member = support::account(&accounts, "member").await;
    let service = MessageService::new(accounts);
    let id = community(&pool, &owner, "group").await;
    let admit =
        sqlx::query("INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)")
            .bind(id)
            .bind(member.user_id);
    admit.execute(&pool).await.unwrap();
    let sent = service.send(member.clone(), message(id)).await.unwrap();
    let pin = support::messaging::command(
        id,
        json!({
            "kind": "pin",
            "message_id": sent.message.id,
            "is_pinned": true
        }),
    );
    assert!(service.command(member.clone(), pin.clone()).await.is_err());
    assert!(service.command(owner.clone(), pin).await.is_ok());
    let edit = support::messaging::command(
        id,
        json!({
            "kind": "edit",
            "message_id": sent.message.id,
            "expected_version": "1",
            "content": {"schema_version": 1, "text": "Impersonation", "custom_emoji": []}
        }),
    );
    assert!(service.command(owner.clone(), edit).await.is_err());
    let expiry = support::messaging::command(id, json!({"kind": "expiry", "days": 1}));
    assert!(service.command(member, expiry).await.is_err());
    let delete = support::messaging::command(
        id,
        json!({
            "kind": "delete",
            "message_id": sent.message.id
        }),
    );
    assert!(service.command(owner, delete).await.is_ok());
}
