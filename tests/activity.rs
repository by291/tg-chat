#[allow(dead_code)]
mod support;

use std::{collections::HashMap, time::Duration};

use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tg_chat::{
    config::ServiceKind,
    features::{
        accounts::mail::{MailQueue, MailSettings},
        accounts::{
            AccountService, AccountSettings, Actor, Login, Registration, SessionGrant,
            http::AccountHttpState, transport::HttpSettings,
        },
        contacts::{Audience, PrivacySettings, RelationshipChange},
        messages::MessageService,
        realtime::Activity,
    },
    http::{ApplicationState, router_with_api},
};
use tower::ServiceExt;
use uuid::Uuid;

const HEARTBEAT_PATH: &str = "/api/v1/activity/heartbeat";
const ORIGIN: &str = "http://localhost:8080";
const INACCESSIBLE_VALKEY: &str = "redis://127.0.0.1:1";
const TEST_PASSWORD: &str = "a complete password phrase";

struct Browser<'application> {
    application: &'application Router,
    grant: &'application SessionGrant,
}

impl Browser<'_> {
    async fn send(&self, method: Method, path: &str, payload: Value) -> (StatusCode, Value) {
        let request = Request::builder().method(method).uri(path);
        let request = request.header("origin", ORIGIN).header("x-tg-chat-request", "1");
        let request = request.header("x-csrf-token", &self.grant.csrf_token);
        let request = request.header("cookie", format!("tg_chat_session={}", self.grant.token));
        let request = request.header("content-type", "application/json");
        let request = request.body(Body::from(payload.to_string())).unwrap();

        let response = self.application.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();

        (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
    }

    async fn heartbeat(&self, payload: Value) {
        let (status, response) = self.send(Method::POST, HEARTBEAT_PATH, payload).await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{response}");
    }

    async fn typing(&self, conversation_id: Uuid, payload: Value) {
        let path = format!("/api/v1/conversations/{conversation_id}/typing");
        let (status, response) = self.send(Method::POST, &path, payload).await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{response}");
    }

    async fn presence(&self, path: &str) -> (StatusCode, Value) {
        self.send(Method::GET, path, Value::Null).await
    }
}

fn values(valkey_url: &str) -> HashMap<String, String> {
    HashMap::from([
        ("TG_CHAT_VALKEY_URL".to_owned(), valkey_url.to_owned()),
        ("TG_CHAT_RATE_NAMESPACE".to_owned(), Uuid::new_v4().to_string()),
    ])
}

fn application(pool: PgPool, values: &HashMap<String, String>) -> Router {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let transport = HttpSettings::from_values(values).unwrap();
    let mail_settings = MailSettings::from_values(values).unwrap();
    let mail = MailQueue::new(pool.clone(), mail_settings).unwrap();
    let routes =
        tg_chat::features::accounts::http::router(AccountHttpState::new(accounts, transport, mail));

    router_with_api(
        ApplicationState {
            pool,
            service: ServiceKind::Api,
        },
        routes,
    )
}

async fn register(accounts: &AccountService, username: &str) -> (SessionGrant, Actor) {
    let grant = accounts
        .register(Registration {
            username: username.to_owned(),
            display_name: username.to_owned(),
            password: TEST_PASSWORD.to_owned(),
            device_name: "Browser".to_owned(),
        })
        .await
        .unwrap();
    let actor = accounts.authenticate(&grant.token).await.unwrap();

    (grant, actor)
}

fn relationship(owner: &Actor, target: &Actor) -> RelationshipChange {
    RelationshipChange {
        actor: owner.clone(),
        target_id: target.user_id,
    }
}

async fn set_presence_audience(accounts: &AccountService, actor: &Actor, presence: Audience) {
    accounts
        .update_privacy(
            actor,
            PrivacySettings {
                direct_messages: Audience::Everyone,
                calls: Audience::Contacts,
                presence,
            },
        )
        .await
        .unwrap();
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and Valkey"]
async fn activity_expires_and_is_fenced_by_current_audience_and_membership(pool: PgPool) {
    let valkey_url = std::env::var("TG_CHAT_TEST_VALKEY_URL").unwrap();
    let application = application(pool.clone(), &values(&valkey_url));
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let (alice_grant, alice) = register(&accounts, "alice").await;
    let (bobby_grant, bobby) = register(&accounts, "bobby").await;
    let messages = MessageService::new(accounts.clone());
    let input = support::messaging::send_input(bobby.user_id);
    let direct = messages.send(alice.clone(), input).await.unwrap().conversation.id;
    let alice_browser = Browser {
        application: &application,
        grant: &alice_grant,
    };
    let bobby_browser = Browser {
        application: &application,
        grant: &bobby_grant,
    };
    let alice_tab = Uuid::new_v4();
    let second_tab = Uuid::new_v4();
    let bobby_tab = Uuid::new_v4();
    let target = alice.user_id;
    let contact_path = format!("/api/v1/activity/presence/{target}");
    let direct_path = format!("{contact_path}?conversation_id={direct}&tab_id={bobby_tab}");

    set_presence_audience(&accounts, &alice, Audience::Everyone).await;
    alice_browser
        .heartbeat(json!({
            "tab_id": alice_tab,
            "sequence": "1",
            "is_foreground": true,
            "conversation_id": direct
        }))
        .await;
    assert_eq!(bobby_browser.presence(&contact_path).await.0, StatusCode::NOT_FOUND);
    assert_eq!(bobby_browser.presence(&direct_path).await.0, StatusCode::NOT_FOUND);
    bobby_browser
        .heartbeat(json!({
            "tab_id": bobby_tab,
            "sequence": "1",
            "is_foreground": true,
            "conversation_id": direct
        }))
        .await;
    let (status, presence) = bobby_browser.presence(&direct_path).await;
    assert_eq!(status, StatusCode::OK);
    assert!(presence["online_for_ms"].as_u64().unwrap() > 0);
    assert_eq!(presence["typing_for_ms"], 0);

    set_presence_audience(&accounts, &alice, Audience::Contacts).await;
    assert_eq!(bobby_browser.presence(&direct_path).await.0, StatusCode::NOT_FOUND);
    accounts.add_contact(relationship(&alice, &bobby)).await.unwrap();
    assert_eq!(bobby_browser.presence(&direct_path).await.0, StatusCode::OK);
    accounts.add_contact(relationship(&bobby, &alice)).await.unwrap();
    assert_eq!(bobby_browser.presence(&contact_path).await.0, StatusCode::OK);

    set_presence_audience(&accounts, &alice, Audience::Nobody).await;
    assert_eq!(bobby_browser.presence(&contact_path).await.0, StatusCode::NOT_FOUND);
    assert_eq!(bobby_browser.presence(&direct_path).await.0, StatusCode::NOT_FOUND);
    set_presence_audience(&accounts, &alice, Audience::Everyone).await;
    for (owner, target) in [(&alice, &bobby), (&bobby, &alice)] {
        accounts.add_block(relationship(owner, target)).await.unwrap();
        assert_eq!(bobby_browser.presence(&contact_path).await.0, StatusCode::NOT_FOUND);
        assert_eq!(bobby_browser.presence(&direct_path).await.0, StatusCode::NOT_FOUND);
        accounts.remove_block(relationship(owner, target)).await.unwrap();
    }
    accounts.remove_contact(relationship(&bobby, &alice)).await.unwrap();

    alice_browser
        .heartbeat(json!({
            "tab_id": second_tab,
            "sequence": "1",
            "is_foreground": true,
            "conversation_id": direct
        }))
        .await;
    alice_browser
        .typing(direct, json!({"tab_id": second_tab, "sequence": "2", "is_typing": true}))
        .await;
    alice_browser
        .typing(direct, json!({"tab_id": alice_tab, "sequence": "2", "is_typing": false}))
        .await;
    alice_browser
        .heartbeat(json!({"tab_id": alice_tab, "sequence": "3", "is_foreground": false}))
        .await;
    let (_, presence) = bobby_browser.presence(&direct_path).await;
    assert!(presence["typing_for_ms"].as_u64().unwrap() > 0);

    alice_browser
        .typing(direct, json!({"tab_id": second_tab, "sequence": "3", "is_typing": false}))
        .await;
    alice_browser
        .typing(direct, json!({"tab_id": second_tab, "sequence": "2", "is_typing": true}))
        .await;
    let (_, presence) = bobby_browser.presence(&direct_path).await;
    assert_eq!(presence["typing_for_ms"], 0);

    alice_browser
        .typing(direct, json!({"tab_id": second_tab, "sequence": "4", "is_typing": true}))
        .await;
    let (_, presence) = bobby_browser.presence(&direct_path).await;
    assert!(presence["typing_for_ms"].as_u64().unwrap() > 0);
    tokio::time::sleep(Duration::from_millis(6200)).await;
    let (_, presence) = bobby_browser.presence(&direct_path).await;
    assert_eq!(presence["typing_for_ms"], 0);
    assert!(presence["online_for_ms"].as_u64().unwrap() > 0);

    accounts
        .revoke_session(tg_chat::features::accounts::RevokeSession {
            actor: alice.clone(),
            session_id: alice.session_id,
        })
        .await
        .unwrap();
    let (_, presence) = bobby_browser.presence(&direct_path).await;
    assert_eq!(presence["online_for_ms"], 0);
    let (status, _) = alice_browser
        .send(
            Method::POST,
            HEARTBEAT_PATH,
            json!({"tab_id": second_tab, "sequence": "5", "is_foreground": true}),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let close = support::messaging::command(direct, json!({"kind": "close"}));
    messages.command(bobby.clone(), close).await.unwrap();
    assert_eq!(bobby_browser.presence(&direct_path).await.0, StatusCode::NOT_FOUND);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn activity_loss_returns_unknown_while_authorized_message_history_remains_usable(
    pool: PgPool,
) {
    let application = application(pool.clone(), &values(INACCESSIBLE_VALKEY));
    let accounts = AccountService::new(pool, AccountSettings::default());
    let (alice_grant, alice) = register(&accounts, "alice").await;
    let (_, bobby) = register(&accounts, "bobby").await;
    let messages = MessageService::new(accounts.clone());
    let input = support::messaging::send_input(bobby.user_id);
    let sent = messages.send(alice.clone(), input).await.unwrap();
    accounts
        .add_contact(RelationshipChange {
            actor: alice.clone(),
            target_id: bobby.user_id,
        })
        .await
        .unwrap();
    set_presence_audience(&accounts, &bobby, Audience::Everyone).await;
    let browser = Browser {
        application: &application,
        grant: &alice_grant,
    };
    let path = format!("/api/v1/activity/presence/{}", bobby.user_id);
    assert_eq!(browser.presence(&path).await.0, StatusCode::SERVICE_UNAVAILABLE);
    let history_path = format!("/api/v1/conversations/{}/history", sent.conversation.id);
    let (status, history) = browser.send(Method::GET, &history_path, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(history["messages"][0]["id"], sent.message.id.to_string());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and Valkey"]
async fn foreground_is_session_scoped_and_expires_without_refresh(pool: PgPool) {
    let valkey_url = std::env::var("TG_CHAT_TEST_VALKEY_URL").unwrap();
    let values = values(&valkey_url);
    let application = application(pool.clone(), &values);
    let accounts = AccountService::new(pool, AccountSettings::default());
    let (grant, actor) = register(&accounts, "alice").await;
    let second_grant = accounts
        .login(Login {
            username: "alice".to_owned(),
            password: TEST_PASSWORD.to_owned(),
            device_name: "Other browser".to_owned(),
        })
        .await
        .unwrap();
    let transport = HttpSettings::from_values(&values).unwrap();
    let activity = Activity::new(accounts.clone(), &transport, None);
    let first_tab = Uuid::new_v4();
    let second_tab = Uuid::new_v4();
    let browser = Browser {
        application: &application,
        grant: &grant,
    };

    for tab_id in [first_tab, second_tab] {
        browser.heartbeat(json!({"tab_id": tab_id, "sequence": "1", "is_foreground": true})).await;
    }
    browser.heartbeat(json!({"tab_id": first_tab, "sequence": "2", "is_foreground": false})).await;
    assert!(activity.is_foreground(actor.session_id).await);
    assert!(!activity.is_foreground(second_grant.session.id).await);

    tokio::time::sleep(Duration::from_secs(46)).await;
    assert!(!activity.is_foreground(actor.session_id).await);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and Valkey"]
async fn reopening_a_direct_chat_does_not_revive_typing_from_the_previous_membership(pool: PgPool) {
    let valkey_url = std::env::var("TG_CHAT_TEST_VALKEY_URL").unwrap();
    let application = application(pool.clone(), &values(&valkey_url));
    let accounts = AccountService::new(pool, AccountSettings::default());
    let (alice_grant, alice) = register(&accounts, "alice").await;
    let (bobby_grant, bobby) = register(&accounts, "bobby").await;
    set_presence_audience(&accounts, &alice, Audience::Everyone).await;
    let messages = MessageService::new(accounts);
    let input = support::messaging::send_input(bobby.user_id);
    let conversation_id = messages.send(alice.clone(), input).await.unwrap().conversation.id;
    let alice_browser = Browser {
        application: &application,
        grant: &alice_grant,
    };
    let bobby_browser = Browser {
        application: &application,
        grant: &bobby_grant,
    };
    let alice_tab = Uuid::new_v4();
    let bobby_tab = Uuid::new_v4();
    let target = alice.user_id;
    let path = format!(
        "/api/v1/activity/presence/{target}?conversation_id={conversation_id}&tab_id={bobby_tab}"
    );
    for (browser, tab_id) in [(&alice_browser, alice_tab), (&bobby_browser, bobby_tab)] {
        browser
            .heartbeat(json!({
                "tab_id": tab_id,
                "sequence": "1",
                "is_foreground": true,
                "conversation_id": conversation_id
            }))
            .await;
    }
    alice_browser
        .typing(conversation_id, json!({"tab_id": alice_tab, "sequence": "2", "is_typing": true}))
        .await;
    let (_, presence) = bobby_browser.presence(&path).await;
    assert!(presence["typing_for_ms"].as_u64().unwrap() > 0);

    let close = support::messaging::command(conversation_id, json!({"kind": "close"}));
    messages.command(alice, close).await.unwrap();
    assert_eq!(bobby_browser.presence(&path).await.0, StatusCode::NOT_FOUND);
    let reopen = support::messaging::send_input(target);
    messages.send(bobby, reopen).await.unwrap();

    let (status, presence) = bobby_browser.presence(&path).await;
    assert_eq!(status, StatusCode::OK);
    assert!(presence["online_for_ms"].as_u64().unwrap() > 0);
    assert_eq!(presence["typing_for_ms"], 0);
}
