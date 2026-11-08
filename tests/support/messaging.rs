use serde_json::json;
use sqlx::PgPool;
use tg_chat::{
    accounts::{AccountService, AccountSettings, Actor},
    messages::{MessageCommand, MessageService, SendMessage},
};
use uuid::Uuid;

/// Build a text send with stable operation and message identities.
pub fn send_input(recipient: Uuid) -> SendMessage {
    serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "message_id": Uuid::new_v4(),
        "destination": {"kind": "recipient", "user_id": recipient},
        "content": {
            "schema_version": 1,
            "text": "Original text",
            "custom_emoji": []
        }
    }))
    .unwrap()
}

/// Build one desired-state command from its public JSON contract.
pub fn command(conversation_id: Uuid, action: serde_json::Value) -> MessageCommand {
    serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "conversation_id": conversation_id,
        "action": action
    }))
    .unwrap()
}

/// Register two participants sharing one isolated database.
pub async fn fixture(pool: PgPool) -> (MessageService, Actor, Actor) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let alice = super::account(&accounts, "alice").await;
    let bobby = super::account(&accounts, "bobby").await;

    (MessageService::new(accounts), alice, bobby)
}
