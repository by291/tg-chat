#[allow(dead_code)]
mod support;

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use tg_chat::{
    accounts::{AccountError, Actor},
    jobs::link_previews::LinkPreviews,
    messages::{MessageService, SendReceipt},
};
use tokio::{net::TcpListener, sync::mpsc, task::JoinHandle};
use url::Url;
use uuid::Uuid;

use support::messaging::{command, fixture, send_input};

const FIRST_URL: &str = "https://example.com/original";
const NEXT_URL: &str = "https://example.com/replacement";

struct Fetcher {
    endpoint: Url,
    server: JoinHandle<()>,
}

impl Drop for Fetcher {
    fn drop(&mut self) {
        self.server.abort();
    }
}

struct FetchRequest {
    url: String,
    complete: tokio::sync::oneshot::Sender<StatusCode>,
}

async fn control_route(
    State(requests): State<mpsc::Sender<FetchRequest>>,
    Json(request): Json<Value>,
) -> Response {
    let url = request["url"].as_str().unwrap().to_owned();
    let (complete, outcome) = tokio::sync::oneshot::channel();
    requests
        .send(FetchRequest {
            url,
            complete,
        })
        .await
        .unwrap();
    let status = outcome.await.unwrap();
    (
        status,
        Json(json!({
            "site_name": "Example",
            "title": "Example preview",
            "summary": "A plain text summary",
        })),
    )
        .into_response()
}

async fn fetcher() -> (Fetcher, mpsc::Receiver<FetchRequest>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/preview", listener.local_addr().unwrap()).parse().unwrap();
    let (send_requests, receive_requests) = mpsc::channel(1);
    let router = Router::new().route("/preview", post(control_route)).with_state(send_requests);
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    (
        Fetcher {
            endpoint,
            server,
        },
        receive_requests,
    )
}

struct LinkedMessage<'a> {
    recipient: Uuid,
    url: &'a str,
    is_preview_disabled: bool,
}

async fn send_link(
    service: &MessageService,
    sender: Actor,
    input: LinkedMessage<'_>,
) -> SendReceipt {
    let mut message = serde_json::to_value(send_input(input.recipient)).unwrap();
    message["content"]["text"] = json!(format!("Read {}", input.url));
    if input.is_preview_disabled {
        message["disable_link_preview"] = json!(true);
    }

    service.send(sender, serde_json::from_value(message).unwrap()).await.unwrap()
}

async fn incoming(requests: &mut mpsc::Receiver<FetchRequest>) -> FetchRequest {
    let deadline = std::time::Duration::from_secs(3);
    tokio::time::timeout(deadline, requests.recv()).await.unwrap().unwrap()
}

async fn card(service: &MessageService, actor: Actor, message: Uuid) -> Value {
    let current = service.message(actor, message).await.unwrap();
    serde_json::to_value(current).unwrap()["link_preview"].clone()
}

#[tokio::test]
async fn draft_lookup_relays_text_metadata_without_persisting_a_job() {
    let pool =
        PgPoolOptions::new().connect_lazy("postgres://localhost/unused_preview_test").unwrap();
    let (fetcher, mut requests) = fetcher().await;
    let previews = LinkPreviews::new(pool, fetcher.endpoint.clone()).unwrap();
    let lookup = tokio::spawn(async move { previews.lookup(FIRST_URL).await });

    let request = incoming(&mut requests).await;
    assert_eq!(request.url, FIRST_URL);
    request.complete.send(StatusCode::OK).unwrap();

    let preview = lookup.await.unwrap().unwrap();
    assert_eq!(preview.url, FIRST_URL);
    assert_eq!(preview.site_name, "Example");
    assert_eq!(preview.title, "Example preview");
    assert_eq!(preview.summary, "A plain text summary");
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn stale_preview_jobs_cannot_restore_edited_or_expired_cards(pool: PgPool) {
    let (service, sender, reader) = fixture(pool.clone()).await;
    let (fetcher, mut requests) = fetcher().await;
    let previews = LinkPreviews::new(pool.clone(), fetcher.endpoint.clone()).unwrap();
    let sent = send_link(
        &service,
        sender.clone(),
        LinkedMessage {
            recipient: reader.user_id,
            url: FIRST_URL,
            is_preview_disabled: false,
        },
    )
    .await;
    let message = sent.message.id;
    let conversation = sent.conversation.id;

    let worker = previews.clone();
    let fetching = tokio::spawn(async move { worker.process_next().await });
    let old = incoming(&mut requests).await;
    assert_eq!(old.url, FIRST_URL);

    let edit = command(
        conversation,
        json!({
            "kind": "edit",
            "message_id": message,
            "expected_version": sent.message.version,
            "content": {
                "schema_version": 1,
                "text": format!("New link {NEXT_URL}"),
                "custom_emoji": [],
            },
        }),
    );
    service.command(sender, edit).await.unwrap();
    old.complete.send(StatusCode::OK).unwrap();
    assert!(fetching.await.unwrap().unwrap());
    assert!(card(&service, reader.clone(), message).await.is_null());

    let worker = previews.clone();
    let fetching = tokio::spawn(async move { worker.process_next().await });
    let replacement = incoming(&mut requests).await;
    assert_eq!(replacement.url, NEXT_URL);
    sqlx::query("UPDATE messages SET expires_at = clock_timestamp() WHERE id = $1")
        .bind(message)
        .execute(&pool)
        .await
        .unwrap();

    replacement.complete.send(StatusCode::OK).unwrap();
    assert!(fetching.await.unwrap().unwrap());
    assert!(matches!(service.message(reader, message).await, Err(AccountError::NotFound)));
    let has_metadata: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM message_link_previews
         WHERE message_id = $1 AND metadata IS NOT NULL)",
    )
    .bind(message)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!has_metadata);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn preview_failure_leaves_the_message_and_link_usable(pool: PgPool) {
    let (service, sender, reader) = fixture(pool.clone()).await;
    let (fetcher, mut requests) = fetcher().await;
    let previews = LinkPreviews::new(pool, fetcher.endpoint.clone()).unwrap();
    let sent = send_link(
        &service,
        sender.clone(),
        LinkedMessage {
            recipient: reader.user_id,
            url: FIRST_URL,
            is_preview_disabled: false,
        },
    )
    .await;
    assert!(card(&service, reader.clone(), sent.message.id).await.is_null());

    let worker = previews.clone();
    let fetching = tokio::spawn(async move { worker.process_next().await });
    let request = incoming(&mut requests).await;
    assert_eq!(request.url, FIRST_URL);
    request.complete.send(StatusCode::BAD_GATEWAY).unwrap();
    assert!(fetching.await.unwrap().unwrap());

    let current = service.message(reader.clone(), sent.message.id).await.unwrap();
    assert_eq!(current.content.text, format!("Read {FIRST_URL}"));
    assert_eq!(current.interaction_version, sent.message.interaction_version);
    assert!(serde_json::to_value(current).unwrap()["link_preview"].is_null());

    let disabled = send_link(
        &service,
        sender,
        LinkedMessage {
            recipient: reader.user_id,
            url: NEXT_URL,
            is_preview_disabled: true,
        },
    )
    .await;
    assert!(!previews.process_next().await.unwrap());
    assert!(card(&service, reader, disabled.message.id).await.is_null());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn successful_preview_publishes_original_link_and_new_revision(pool: PgPool) {
    let (service, sender, reader) = fixture(pool.clone()).await;
    let (fetcher, mut requests) = fetcher().await;
    let previews = LinkPreviews::new(pool.clone(), fetcher.endpoint.clone()).unwrap();
    let links = format!("http://127.0.0.1/notes ({FIRST_URL})");
    let sent = send_link(
        &service,
        sender,
        LinkedMessage {
            recipient: reader.user_id,
            url: &links,
            is_preview_disabled: false,
        },
    )
    .await;

    let worker = previews.clone();
    let fetching = tokio::spawn(async move { worker.process_next().await });
    let request = incoming(&mut requests).await;
    assert_eq!(request.url, FIRST_URL);
    request.complete.send(StatusCode::OK).unwrap();
    assert!(fetching.await.unwrap().unwrap());

    let current = service.message(reader.clone(), sent.message.id).await.unwrap();
    assert_eq!(current.version, sent.message.version);
    assert_ne!(current.interaction_version, sent.message.interaction_version);
    assert_eq!(
        serde_json::to_value(current).unwrap()["link_preview"],
        json!({
            "url": FIRST_URL,
            "site_name": "Example",
            "title": "Example preview",
            "summary": "A plain text summary",
        }),
    );
    let changes: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM personal_changes WHERE user_id = $1 AND message_id = $2",
    )
    .bind(reader.user_id)
    .bind(sent.message.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(changes, 2);
    assert!(!previews.process_next().await.unwrap());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn deleting_a_message_revokes_its_running_preview(pool: PgPool) {
    let (service, sender, reader) = fixture(pool.clone()).await;
    let (fetcher, mut requests) = fetcher().await;
    let previews = LinkPreviews::new(pool.clone(), fetcher.endpoint.clone()).unwrap();
    let sent = send_link(
        &service,
        sender.clone(),
        LinkedMessage {
            recipient: reader.user_id,
            url: FIRST_URL,
            is_preview_disabled: false,
        },
    )
    .await;
    let message = sent.message.id;

    let fetching = tokio::spawn(async move { previews.process_next().await });
    let old = incoming(&mut requests).await;
    let delete = command(sent.conversation.id, json!({"kind": "delete", "message_id": message}));
    service.command(sender, delete).await.unwrap();

    old.complete.send(StatusCode::OK).unwrap();
    assert!(fetching.await.unwrap().unwrap());
    let has_job: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM message_link_previews WHERE message_id = $1)",
    )
    .bind(message)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!has_job);
    assert!(matches!(service.message(reader, message).await, Err(AccountError::NotFound)));
}
