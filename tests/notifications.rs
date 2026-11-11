#[allow(dead_code)]
mod support;

use std::{
    collections::{HashMap, VecDeque},
    pin::Pin,
    sync::{Arc, Mutex},
};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tg_chat::{
    accounts::{
        AccountError, AccountService, Actor, Login, Registration, RevokeSession, SessionGrant,
        http::{self, AccountHttpState},
        transport::HttpSettings,
    },
    contacts::RelationshipChange,
    messages::{MessageService, SendReceipt},
    notifications::{
        NotificationIdentity, NotificationService, PushSubscriptionInput,
        delivery::{
            PushAttempt, PushClaim, PushOutcome, PushTransport, PushWorker, PushWorkerSettings,
        },
    },
    realtime::Activity,
    sync::SyncQuery,
};
use tower::ServiceExt;
use uuid::Uuid;

const CLIENT_PUBLIC_KEY: &str =
    "BLn9b-VR0ca83knDNZ32dCHGyjJp-1riX9ZTN40MqV8K_LpQmLqxC_DoHvqvFXO_nGdAB4W9dogZb_sM-uV4JbY";
const CLIENT_AUTH: &str = "_ordMnz7uTCmrpBTeUV4Bw";
const PASSWORD: &str = "a complete password phrase";
const TEST_IDLE_DAYS: i64 = 30;

#[derive(Default)]
struct RecordingTransport {
    outcomes: Mutex<VecDeque<PushOutcome>>,
    delivered: Mutex<Vec<(NotificationIdentity, Value)>>,
}

impl PushTransport for RecordingTransport {
    fn send<'a>(
        &'a self,
        attempt: PushAttempt<'a>,
    ) -> Pin<Box<dyn Future<Output = PushOutcome> + Send + 'a>> {
        Box::pin(async move {
            let payload = serde_json::to_value(attempt.payload).unwrap();
            let identity = attempt.payload.identity;
            self.delivered.lock().unwrap().push((identity, payload));
            self.outcomes.lock().unwrap().pop_front().unwrap_or(PushOutcome::Sent)
        })
    }
}

struct Fixture {
    accounts: AccountService,
    messages: MessageService,
    subscriptions: NotificationService,
    sender: Actor,
    recipient: Actor,
    grant: SessionGrant,
}

async fn register(accounts: &AccountService) -> SessionGrant {
    let input = Registration {
        username: "push_session".to_owned(),
        display_name: "Push session".to_owned(),
        password: PASSWORD.to_owned(),
        device_name: "Push browser".to_owned(),
    };
    accounts.register(input).await.unwrap()
}

async fn fixture(pool: &PgPool) -> Fixture {
    let (accounts, _, _) = support::services(pool.clone());
    let grant = register(&accounts).await;
    let recipient = accounts.authenticate(&grant.token).await.unwrap();
    let sender = support::account(&accounts, "push_sender").await;
    let values =
        HashMap::from([("TG_CHAT_PUSH_VAPID_PUBLIC_KEY".to_owned(), CLIENT_PUBLIC_KEY.to_owned())]);
    let subscriptions = NotificationService::from_values(accounts.clone(), &values);
    let messages = MessageService::new(accounts.clone());

    Fixture {
        accounts,
        messages,
        subscriptions,
        sender,
        recipient,
        grant,
    }
}

fn subscription(endpoint: String) -> PushSubscriptionInput {
    PushSubscriptionInput {
        endpoint,
        p256dh: CLIENT_PUBLIC_KEY.to_owned(),
        auth: CLIENT_AUTH.to_owned(),
        expiration_time: None,
    }
}

async fn accept_and_claim(fixture: &Fixture, worker: &PushWorker) -> (SendReceipt, PushClaim) {
    let input = support::messaging::send_input(fixture.recipient.user_id);
    let sent = fixture.messages.send(fixture.sender.clone(), input).await.unwrap();
    assert!(worker.fanout_next().await.unwrap());
    let claim = worker.claim().await.unwrap().unwrap();

    (sent, claim)
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn disabled_push_capability_keeps_the_account_session_usable(pool: PgPool) {
    let (accounts, queue, _) = support::services(pool);
    let grant = register(&accounts).await;
    let settings = HttpSettings::from_values(&Default::default()).unwrap();
    let cookie = settings.session_cookie(&grant.token);
    let router = http::router(AccountHttpState::new(accounts.clone(), settings, queue));
    let request = Request::get("/api/v1/notifications/capability")
        .header("cookie", cookie.split(';').next().unwrap())
        .body(Body::empty())
        .unwrap();
    let response = router.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let capability: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(capability["available"], false);
    assert!(capability.get("vapid_public_key").is_none());
    assert!(accounts.authenticate(&grant.token).await.is_ok());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn claimed_push_is_suppressed_after_read_mute_or_session_revocation(pool: PgPool) {
    let fixture = fixture(&pool).await;
    let input = subscription("https://fcm.googleapis.com/fcm/send/leased".to_owned());
    fixture.subscriptions.subscribe(&fixture.recipient, input).await.unwrap();
    let transport = Arc::new(RecordingTransport::default());
    let worker = PushWorker::new(PushWorkerSettings {
        pool: pool.clone(),
        activity: None,
        idle_days: TEST_IDLE_DAYS,
        transport: Some(transport.clone()),
    });

    let (first, claim) = accept_and_claim(&fixture, &worker).await;
    let read = support::messaging::command(
        first.conversation.id,
        json!({"kind": "read", "through": first.message.sequence}),
    );
    fixture.messages.command(fixture.recipient.clone(), read).await.unwrap();
    worker.dispatch(claim).await.unwrap();

    let (second, claim) = accept_and_claim(&fixture, &worker).await;
    let mute = support::messaging::command(
        second.conversation.id,
        json!({
            "kind": "preferences",
            "change": {"field": "mute", "until": chrono::Utc::now() + chrono::Duration::hours(1)}
        }),
    );
    fixture.messages.command(fixture.recipient.clone(), mute).await.unwrap();
    worker.dispatch(claim).await.unwrap();
    let unmute = support::messaging::command(
        second.conversation.id,
        json!({
            "kind": "preferences",
            "change": {"field": "mute", "until": null}
        }),
    );
    fixture.messages.command(fixture.recipient.clone(), unmute).await.unwrap();

    let (_, claim) = accept_and_claim(&fixture, &worker).await;
    let relationship = RelationshipChange {
        actor: fixture.recipient.clone(),
        target_id: fixture.sender.user_id,
    };
    fixture.accounts.add_block(relationship).await.unwrap();
    worker.dispatch(claim).await.unwrap();
    let relationship = RelationshipChange {
        actor: fixture.recipient.clone(),
        target_id: fixture.sender.user_id,
    };
    fixture.accounts.remove_block(relationship).await.unwrap();

    let (quarantined, claim) = accept_and_claim(&fixture, &worker).await;
    let quarantine = sqlx::query("UPDATE conversations SET is_quarantined = true WHERE id = $1");
    quarantine.bind(quarantined.conversation.id).execute(&pool).await.unwrap();
    worker.dispatch(claim).await.unwrap();
    let restore = sqlx::query("UPDATE conversations SET is_quarantined = false WHERE id = $1");
    restore.bind(quarantined.conversation.id).execute(&pool).await.unwrap();

    let (expired, claim) = accept_and_claim(&fixture, &worker).await;
    let expire = sqlx::query("UPDATE messages SET expires_at = clock_timestamp() WHERE id = $1");
    expire.bind(expired.message.id).execute(&pool).await.unwrap();
    worker.dispatch(claim).await.unwrap();

    let (_, claim) = accept_and_claim(&fixture, &worker).await;
    let revocation = RevokeSession {
        actor: fixture.recipient.clone(),
        session_id: fixture.recipient.session_id,
    };
    fixture.accounts.revoke_session(revocation).await.unwrap();
    worker.dispatch(claim).await.unwrap();
    assert!(transport.delivered.lock().unwrap().is_empty());
    let query = sqlx::query_scalar::<_, i64>(
        "SELECT read_through FROM conversation_members WHERE conversation_id = $1 AND user_id = $2",
    );
    let query = query.bind(first.conversation.id).bind(fixture.recipient.user_id);
    assert_eq!(query.fetch_one(&pool).await.unwrap().to_string(), first.message.sequence);
    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM push_subscriptions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, 0);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn ambiguous_delivery_reuses_notification_identity_and_retires_invalid_endpoints(
    pool: PgPool,
) {
    let fixture = fixture(&pool).await;
    let denied = subscription("https://fcm.googleapis.com.evil.example/fcm/send/lease".to_owned());
    let denied = fixture.subscriptions.subscribe(&fixture.recipient, denied).await;
    assert!(matches!(denied, Err(AccountError::Validation(_))));
    let endpoint = "https://fcm.googleapis.com/fcm/send/ambiguous";
    let original =
        fixture.subscriptions.subscribe(&fixture.recipient, subscription(endpoint.into()));
    let original = original.await.unwrap();
    let repeated =
        fixture.subscriptions.subscribe(&fixture.recipient, subscription(endpoint.into()));
    assert_eq!(repeated.await.unwrap().subscription_id, original.subscription_id);

    let transport = Arc::new(RecordingTransport::default());
    transport.outcomes.lock().unwrap().extend([
        PushOutcome::Rejected,
        PushOutcome::Retry,
        PushOutcome::EndpointGone,
    ]);
    let worker = PushWorker::new(PushWorkerSettings {
        pool: pool.clone(),
        activity: None,
        idle_days: TEST_IDLE_DAYS,
        transport: Some(transport.clone()),
    });
    let (_, claim) = accept_and_claim(&fixture, &worker).await;
    worker.dispatch(claim).await.unwrap();
    assert!(worker.claim().await.unwrap().is_none());
    let (sent, claim) = accept_and_claim(&fixture, &worker).await;
    worker.dispatch(claim).await.unwrap();
    assert!(worker.claim().await.unwrap().is_none());
    let make_due = sqlx::query(
        "UPDATE push_deliveries SET available_at = clock_timestamp() WHERE message_id = $1",
    );
    make_due.bind(sent.message.id).execute(&pool).await.unwrap();
    let claim = worker.claim().await.unwrap().unwrap();
    worker.dispatch(claim).await.unwrap();

    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM push_subscriptions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, 0);
    let deliveries = transport.delivered.lock().unwrap();
    assert_eq!(deliveries.len(), 3);
    let first = &deliveries[1];
    assert_eq!(first, &deliveries[2]);
    assert_eq!(first.0.message_id, sent.message.id);
    assert_eq!(first.0.subscription_id, original.subscription_id);
    assert_eq!(
        first.1,
        json!({
            "identity": first.0,
            "conversation_id": sent.conversation.id,
        })
    );
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn connected_alerts_distinguish_accepted_messages_from_edits(pool: PgPool) {
    let fixture = fixture(&pool).await;
    let baseline = fixture.messages.bootstrap(fixture.recipient.clone()).await.unwrap();
    let input = support::messaging::send_input(fixture.recipient.user_id);
    let sent = fixture.messages.send(fixture.sender.clone(), input).await.unwrap();
    let edit = support::messaging::command(
        sent.conversation.id,
        json!({
            "kind": "edit",
            "message_id": sent.message.id,
            "expected_version": sent.message.version,
            "content": {"schema_version": 1, "text": "Edited text", "custom_emoji": []}
        }),
    );
    fixture.messages.command(fixture.sender, edit).await.unwrap();

    let query = SyncQuery {
        cursor: baseline.cursor,
        limit: None,
    };
    let sync = fixture.messages.sync(fixture.recipient, query).await.unwrap();
    let markers: Vec<bool> = sync
        .groups
        .iter()
        .filter(|group| group.message.as_ref().is_some_and(|message| message.id == sent.message.id))
        .map(|group| group.is_new_message)
        .collect();
    assert_eq!(markers, [true, false]);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and Valkey"]
async fn a_foreground_tab_suppresses_only_its_subscribed_session(pool: PgPool) {
    let fixture = fixture(&pool).await;
    let second_grant = fixture.accounts.login(Login {
        username: "push_session".to_owned(),
        password: PASSWORD.to_owned(),
        device_name: "Background browser".to_owned(),
    });
    let second_grant = second_grant.await.unwrap();
    let second = fixture.accounts.authenticate(&second_grant.token).await.unwrap();
    let input = subscription("https://fcm.googleapis.com/fcm/send/foreground".to_owned());
    fixture.subscriptions.subscribe(&fixture.recipient, input).await.unwrap();
    let input = subscription("https://fcm.googleapis.com/fcm/send/background".to_owned());
    let background = fixture.subscriptions.subscribe(&second, input).await.unwrap();

    let valkey_url = std::env::var("TG_CHAT_TEST_VALKEY_URL").unwrap();
    let values = HashMap::from([
        ("TG_CHAT_VALKEY_URL".to_owned(), valkey_url),
        ("TG_CHAT_RATE_NAMESPACE".to_owned(), Uuid::new_v4().to_string()),
    ]);
    let settings = HttpSettings::from_values(&values).unwrap();
    let activity = Activity::new(fixture.accounts.clone(), &settings, None);
    let cookie = settings.session_cookie(&fixture.grant.token);
    let state = AccountHttpState::new(
        fixture.accounts.clone(),
        settings,
        support::mail_queue(pool.clone()),
    );
    let payload = json!({
        "tab_id": Uuid::new_v4(),
        "sequence": "1",
        "is_foreground": true,
    });
    let request = Request::post("/api/v1/activity/heartbeat")
        .header("content-type", "application/json")
        .header("origin", "http://localhost:8080")
        .header("x-tg-chat-request", "1")
        .header("x-csrf-token", &fixture.grant.csrf_token)
        .header("cookie", cookie.split(';').next().unwrap())
        .body(Body::from(payload.to_string()))
        .unwrap();
    let response = http::router(state).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let transport = Arc::new(RecordingTransport::default());
    let worker = PushWorker::new(PushWorkerSettings {
        pool,
        activity: Some(activity),
        idle_days: TEST_IDLE_DAYS,
        transport: Some(transport.clone()),
    });
    let (_, first) = accept_and_claim(&fixture, &worker).await;
    let second = worker.claim().await.unwrap().unwrap();
    worker.dispatch(first).await.unwrap();
    worker.dispatch(second).await.unwrap();
    let deliveries = transport.delivered.lock().unwrap();
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].0.subscription_id, background.subscription_id);
}
