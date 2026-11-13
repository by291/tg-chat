#[allow(dead_code)]
pub mod messaging;

use std::collections::HashMap;

use base64::{Engine, engine::general_purpose::STANDARD};
use sqlx::PgPool;
use tg_chat::features::{
    accounts::mail::{DeliveryOutcome, MailQueue, MailSettings},
    accounts::{AccountService, AccountSettings, Actor, Registration, email::EmailService},
};

const TEST_KEY: [u8; 32] = [37; 32];

/// Create real SMTP and encrypted-queue settings for isolated integration tests.
pub fn mail_queue(pool: PgPool) -> MailQueue {
    let mut values = HashMap::new();
    values.insert("TG_CHAT_SMTP_HOST".to_owned(), "127.0.0.1".to_owned());
    values.insert("TG_CHAT_SMTP_PORT".to_owned(), "65409".to_owned());
    values.insert("TG_CHAT_SMTP_MODE".to_owned(), "plain".to_owned());
    values.insert("TG_CHAT_MAIL_FROM".to_owned(), "accounts@example.test".to_owned());
    values.insert("TG_CHAT_MAIL_KEY".to_owned(), STANDARD.encode(TEST_KEY));
    if let Ok(host) = std::env::var("TG_CHAT_TEST_SMTP_HOST") {
        values.insert("TG_CHAT_SMTP_HOST".to_owned(), host);
    }
    if let Ok(port) = std::env::var("TG_CHAT_TEST_SMTP_PORT") {
        values.insert("TG_CHAT_SMTP_PORT".to_owned(), port);
    }

    MailQueue::new(pool, MailSettings::from_values(&values).unwrap()).unwrap()
}

/// Register one account and return its authenticated ownership context.
pub async fn account(accounts: &AccountService, username: &str) -> Actor {
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

/// Share one database pool across account transactions and mail intent.
pub fn services(pool: PgPool) -> (AccountService, MailQueue, EmailService) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let queue = mail_queue(pool);
    let email = EmailService::new(accounts.clone(), queue.clone());

    (accounts, queue, email)
}

/// Read a claimed delivery payload and acknowledge it as an email recipient would.
pub async fn mailed_token(queue: &MailQueue) -> String {
    let claim = queue.claim().await.unwrap().unwrap();
    let outgoing = queue.prepare(&claim).await.unwrap().unwrap();
    let token = outgoing.body.split("#token=").nth(1).unwrap();
    let token = token.lines().next().unwrap().to_owned();
    assert!(queue.finish(&claim, DeliveryOutcome::Sent).await.unwrap());

    token
}

#[allow(dead_code)]
pub mod media;
