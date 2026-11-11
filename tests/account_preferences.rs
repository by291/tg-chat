#[allow(dead_code)]
mod support;

use std::collections::HashMap;

use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tg_chat::{
    accounts::{
        AccountDeletionOutcome, AccountError, AccountService, DeleteAccount, Login, SessionGrant,
        http::AccountHttpState, preferences::AccountPreferenceChanges, profile::ProfileUpdate,
        transport::HttpSettings,
    },
    contacts::{Audience, DirectoryQuery, PrivacySettings},
    jobs::account_cleanup::cleanup_deleted_account,
    messages::MessageService,
    sync::SyncQuery,
};
use tower::ServiceExt;
use uuid::Uuid;

const PREFERENCES_PATH: &str = "/api/v1/account/preferences";
const BROWSER_ORIGIN: &str = "http://localhost:8080";
const ACCOUNT_PASSWORD: &str = "a complete password phrase";
const PRIVATE_EMAIL: &str = "alice@example.test";
const PRIVATE_PHONE: &str = "alice-private-phone";

struct BrowserRequest<'a> {
    grant: &'a SessionGrant,
    method: Method,
    body: Value,
}

async fn request_preferences(
    application: &Router,
    request: BrowserRequest<'_>,
) -> (StatusCode, Value) {
    let builder = Request::builder().method(request.method).uri(PREFERENCES_PATH);
    let builder = builder
        .header("content-type", "application/json")
        .header("origin", BROWSER_ORIGIN)
        .header("x-tg-chat-request", "1");
    let request = builder
        .header("cookie", format!("tg_chat_session={}", request.grant.token))
        .header("x-csrf-token", &request.grant.csrf_token)
        .body(Body::from(request.body.to_string()))
        .unwrap();
    let response = application.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();

    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn login(accounts: &AccountService, username: &str, device: &str) -> SessionGrant {
    accounts
        .login(Login {
            username: username.to_owned(),
            password: ACCOUNT_PASSWORD.to_owned(),
            device_name: device.to_owned(),
        })
        .await
        .unwrap()
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn settings_refresh_across_sessions_without_overwriting_local_device_preferences(
    pool: PgPool,
) {
    let (accounts, queue, email) = support::services(pool.clone());
    let alice = support::account(&accounts, "alice").await;
    let peer = support::account(&accounts, "peer").await;
    let first = login(&accounts, "alice", "Laptop").await;
    let second = login(&accounts, "alice", "Phone").await;
    let other_session = accounts.authenticate(&second.token).await.unwrap();

    let settings = HttpSettings::from_values(&HashMap::new()).unwrap();
    let state = AccountHttpState::new(accounts.clone(), settings, queue.clone());
    let application = tg_chat::accounts::http::router(state);
    let messages = MessageService::new(accounts.clone());
    let own_bootstrap = messages.bootstrap(other_session.clone()).await.unwrap();
    let peer_bootstrap = messages.bootstrap(peer.clone()).await.unwrap();

    let (status, original) = request_preferences(
        &application,
        BrowserRequest {
            grant: &first,
            method: Method::GET,
            body: Value::Null,
        },
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{original}");
    assert_eq!(original["version"], "1");
    let mut notification_defaults = original["notification_defaults"].clone();
    notification_defaults["private"]["should_notify"] = json!(false);

    let first_order = json!(["Crocosaurus", "UtyaDuck"]);
    let second_order = json!(["shark_animated", "Crocosaurus"]);
    let first_write = request_preferences(
        &application,
        BrowserRequest {
            grant: &first,
            method: Method::PATCH,
            body: json!({
                "expected_version": original["version"],
                "sticker_pack_ids": first_order,
                "notification_defaults": notification_defaults
            }),
        },
    );
    let competing_write = request_preferences(
        &application,
        BrowserRequest {
            grant: &second,
            method: Method::PATCH,
            body: json!({
                "expected_version": original["version"],
                "sticker_pack_ids": second_order,
                "notification_defaults": notification_defaults
            }),
        },
    );
    let (first_result, second_result) = tokio::join!(first_write, competing_write);
    let (accepted, rejected, expected_order) = if first_result.0 == StatusCode::OK {
        (first_result, second_result, first_order)
    } else {
        (second_result, first_result, second_order)
    };
    assert_eq!(accepted.0, StatusCode::OK, "{}", accepted.1);
    assert_eq!(rejected.0, StatusCode::CONFLICT, "{}", rejected.1);
    assert_eq!(accepted.1["sticker_pack_ids"], expected_order);
    assert_eq!(accepted.1["version"], "2");

    let (status, refreshed) = request_preferences(
        &application,
        BrowserRequest {
            grant: &second,
            method: Method::GET,
            body: Value::Null,
        },
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(refreshed, accepted.1);

    for invalid_order in [json!(["unknown-pack"]), json!(["UtyaDuck", "UtyaDuck"])] {
        let (status, body) = request_preferences(
            &application,
            BrowserRequest {
                grant: &first,
                method: Method::PATCH,
                body: json!({"expected_version": "2", "sticker_pack_ids": invalid_order}),
            },
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }

    accounts
        .update_profile(
            &alice,
            ProfileUpdate {
                version: "1".to_owned(),
                display_name: "Alice Example".to_owned(),
                biography: "Public biography".to_owned(),
                phone: Some(PRIVATE_PHONE.to_owned()),
            },
        )
        .await
        .unwrap();
    let cursor = SyncQuery {
        cursor: own_bootstrap.cursor.clone(),
        limit: None,
    };
    let page = messages.sync(other_session.clone(), cursor).await.unwrap();
    assert!(page.groups.is_empty());
    assert_eq!(serde_json::to_value(&page).unwrap()["account_settings_version"], "3");

    accounts
        .update_privacy(
            &alice,
            PrivacySettings {
                direct_messages: Audience::Nobody,
                calls: Audience::Nobody,
                presence: Audience::Nobody,
            },
        )
        .await
        .unwrap();
    email.request_verification(&alice, PRIVATE_EMAIL.to_owned()).await.unwrap();
    email.confirm(support::mailed_token(&queue).await).await.unwrap();
    let latest = messages.bootstrap(other_session).await.unwrap();
    let latest = serde_json::to_value(latest).unwrap();
    assert_eq!(latest["account_settings_version"], "5");
    assert_eq!(latest["user"]["email"], PRIVATE_EMAIL);
    assert_eq!(latest["user"]["phone"], PRIVATE_PHONE);

    let peer_cursor = SyncQuery {
        cursor: peer_bootstrap.cursor,
        limit: None,
    };
    let peer_sync = messages.sync(peer.clone(), peer_cursor).await.unwrap();
    let peer_sync = serde_json::to_value(peer_sync).unwrap();
    assert_eq!(peer_sync["account_settings_version"], "1");
    let directory = accounts
        .discover(
            &peer,
            DirectoryQuery {
                search: Some("Alice".to_owned()),
                ..DirectoryQuery::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(directory.users[0].id, alice.user_id);
    let peer_directory = serde_json::to_value(directory).unwrap();
    let peer_directory = peer_directory.to_string();
    assert!(!peer_directory.contains(PRIVATE_EMAIL));
    assert!(!peer_directory.contains(PRIVATE_PHONE));
    assert!(!peer_directory.contains("notification_defaults"));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn deleting_account_removes_preferences_when_cleanup_completes(pool: PgPool) {
    let (accounts, _, _) = support::services(pool.clone());
    let actor = support::account(&accounts, "alice").await;
    accounts
        .update_preferences(
            &actor,
            AccountPreferenceChanges {
                expected_version: "1".to_owned(),
                notification_defaults: None,
                sticker_pack_ids: Some(vec!["Crocosaurus".to_owned()]),
            },
        )
        .await
        .unwrap();
    let outcome = accounts
        .delete_account(
            &actor,
            DeleteAccount {
                operation_id: Uuid::new_v4(),
                confirm_shared_messages: true,
            },
        )
        .await
        .unwrap();
    assert!(matches!(outcome, AccountDeletionOutcome::Deleted(_)));
    assert!(matches!(accounts.preferences(&actor).await, Err(AccountError::Unauthenticated)));

    const MAX_CLEANUP_STEPS: usize = 10;
    let mut is_complete = false;
    for _ in 0..MAX_CLEANUP_STEPS {
        if !cleanup_deleted_account(&pool).await.unwrap() {
            is_complete = true;
            break;
        }
    }
    assert!(is_complete, "account cleanup did not finish");
    let has_preferences: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM account_preferences WHERE user_id = $1)")
            .bind(actor.user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!has_preferences);
}
