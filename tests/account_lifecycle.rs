#[allow(dead_code)]
mod support;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tg_chat::features::{
    accounts::cleanup::cleanup_deleted_account,
    accounts::{
        AccountDeletionOutcome, AccountError, AccountService, DeleteAccount, Registration,
        SessionGrant,
        email::PasswordReset,
        http::{self, AccountHttpState},
        transport::HttpSettings,
    },
    contacts::RelationshipChange,
    conversations::{CommunityAction, CommunityCommand, CommunitySettings, CreateCommunity},
    media::AttachmentInput,
    messages::{Destination, MessageService},
    moderation::reports::ReportMessage,
    sync::SyncQuery,
};
use tower::ServiceExt;
use uuid::Uuid;

const PASSWORD: &str = "a complete password phrase";
const MAX_CLEANUP_ITERATIONS: usize = 25;

async fn register(accounts: &AccountService, username: &str) -> SessionGrant {
    let input = Registration {
        username: username.to_owned(),
        password: PASSWORD.to_owned(),
        display_name: username.to_owned(),
        device_name: "Deletion browser".to_owned(),
    };
    accounts.register(input).await.unwrap()
}

fn router(accounts: AccountService, pool: PgPool) -> Router {
    let settings = HttpSettings::from_values(&Default::default()).unwrap();
    http::router(AccountHttpState::new(accounts, settings, support::mail_queue(pool)))
}

async fn delete_account(router: Router, grant: &SessionGrant) -> (StatusCode, Value) {
    let settings = HttpSettings::from_values(&Default::default()).unwrap();
    let cookie = settings.session_cookie(&grant.token);
    let payload = json!({
        "operation_id": Uuid::new_v4(),
        "confirm_shared_messages": true,
    });
    let request = Request::post("/api/v1/account/deletion")
        .header("content-type", "application/json")
        .header("origin", "http://localhost:8080")
        .header("x-tg-chat-request", "1")
        .header("x-csrf-token", &grant.csrf_token)
        .header("cookie", cookie.split(';').next().unwrap())
        .body(Body::from(payload.to_string()))
        .unwrap();
    let response = router.oneshot(request).await.unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();

    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

fn community_input() -> CreateCommunity {
    CreateCommunity {
        operation_id: Uuid::new_v4(),
        conversation_id: Uuid::new_v4(),
        kind: "group".to_owned(),
        settings: CommunitySettings {
            title: "Reading group".to_owned(),
            description: String::new(),
            public_handle: Some("reading_group".to_owned()),
            is_public: true,
            requires_approval: false,
        },
    }
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn deletion_and_ownership_changes_cannot_orphan_a_community(pool: PgPool) {
    let (accounts, _, _) = support::services(pool.clone());
    let owner_grant = register(&accounts, "owner").await;
    let owner = accounts.authenticate(&owner_grant.token).await.unwrap();
    let member = support::account(&accounts, "member").await;
    let service = MessageService::new(accounts.clone());
    let application = router(accounts.clone(), pool.clone());

    let input = community_input();
    let conversation_id = input.conversation_id;
    let creation = service.create_community(owner.clone(), input);
    let deletion = delete_account(application.clone(), &owner_grant);
    let (creation, (status, response)) = tokio::join!(creation, deletion);
    if status == StatusCode::OK {
        assert!(matches!(creation, Err(AccountError::Unauthenticated)));
        return;
    }
    assert_eq!(status, StatusCode::CONFLICT, "{response}");
    creation.unwrap();
    assert_eq!(
        response["current"]["communities"][0]["conversation_id"],
        conversation_id.to_string()
    );
    assert!(accounts.authenticate(&owner_grant.token).await.is_ok());

    let join = CommunityCommand {
        operation_id: Uuid::new_v4(),
        conversation_id,
        action: CommunityAction::Join {
            token: None,
            invitation_id: None,
        },
    };
    service.community_command(member.clone(), join).await.unwrap();
    let transfer = CommunityCommand {
        operation_id: Uuid::new_v4(),
        conversation_id,
        action: CommunityAction::Transfer {
            user_id: member.user_id,
        },
    };
    let transfer = service.community_command(owner, transfer);
    let deletion = delete_account(application.clone(), &owner_grant);
    let (transfer, (status, response)) = tokio::join!(transfer, deletion);
    transfer.unwrap();
    assert!(matches!(status, StatusCode::OK | StatusCode::CONFLICT), "{status} {response}");
    if status == StatusCode::CONFLICT {
        assert!(accounts.authenticate(&owner_grant.token).await.is_ok());
        let (status, response) = delete_account(application, &owner_grant).await;
        assert_eq!(status, StatusCode::OK, "{response}");
    }
    let owner: Uuid = sqlx::query_scalar("SELECT owner_id FROM conversations WHERE id = $1")
        .bind(conversation_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(owner, member.user_id);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn deleted_identity_releases_username_without_relinking_shared_history(pool: PgPool) {
    let (accounts, queue, email) = support::services(pool.clone());
    let grant = register(&accounts, "former_sender").await;
    let author = accounts.authenticate(&grant.token).await.unwrap();
    let peer = support::account(&accounts, "peer").await;
    let service = MessageService::new(accounts.clone());
    let application = router(accounts.clone(), pool);
    let address = "former_sender@example.test";
    email.request_verification(&author, address.to_owned()).await.unwrap();
    email.confirm(support::mailed_token(&queue).await).await.unwrap();
    email.request_recovery(address.to_owned()).await.unwrap();
    let reset_token = support::mailed_token(&queue).await;
    let input = support::messaging::send_input(peer.user_id);
    let sent = service.send(author.clone(), input).await.unwrap();

    let (status, response) = delete_account(application.clone(), &grant).await;
    assert_eq!(status, StatusCode::OK, "{response}");
    assert!(matches!(
        accounts.authenticate(&grant.token).await,
        Err(AccountError::Unauthenticated)
    ));
    let (status, _) = delete_account(application, &grant).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let reset = email
        .reset_password(PasswordReset {
            token: reset_token,
            new_password: "a different complete password phrase".to_owned(),
        })
        .await;
    assert!(matches!(reset, Err(AccountError::InvalidChallenge)));
    let replacement = register(&accounts, "former_sender").await;
    assert_ne!(replacement.user.id, author.user_id);

    let fresh = service.message(peer.clone(), sent.message.id).await.unwrap();
    assert_eq!(fresh.author_id, author.user_id);
    assert_eq!(fresh.author_name, "Deleted account");
    assert_eq!(fresh.content.text, sent.message.content.text);
    let direct = support::messaging::send_input(author.user_id);
    let blocked = service.send(peer.clone(), direct).await;
    assert!(matches!(blocked, Err(AccountError::ConversationUnavailable)));
    let profile = accounts.directory_profile(&peer, author.user_id).await;
    assert!(matches!(profile, Err(AccountError::NotFound)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and S3 storage"]
async fn account_cleanup_erases_saved_media_references_and_preserves_case_evidence(pool: PgPool) {
    let (accounts, _, _) = support::services(pool.clone());
    let author = support::account(&accounts, "former_author").await;
    let reader = support::account(&accounts, "reader").await;
    let service = MessageService::new(accounts.clone());
    let file_id = support::media::prepared_document(&pool, &author).await;

    let mut shared = support::messaging::send_input(reader.user_id);
    let occurrence_id = Uuid::new_v4();
    shared.attachments.push(AttachmentInput {
        occurrence_id,
        file_id,
    });
    let mut saved = support::messaging::send_input(reader.user_id);
    saved.destination = Destination::Saved;
    saved.attachments.push(AttachmentInput {
        occurrence_id: Uuid::new_v4(),
        file_id,
    });
    let shared = service.send(author.clone(), shared).await.unwrap();
    let saved = service.send(author.clone(), saved).await.unwrap();
    let report: ReportMessage = serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "reason": "other",
    }))
    .unwrap();
    let receipt = accounts.report_message(reader.clone(), shared.message.id, report).await.unwrap();
    let draft = support::messaging::command(
        shared.conversation.id,
        json!({
            "kind": "draft",
            "expected_version": "0",
            "content": {"schema_version": 1, "text": "Private draft", "custom_emoji": []}
        }),
    );
    service.command(author.clone(), draft).await.unwrap();
    let relationship = RelationshipChange {
        actor: reader.clone(),
        target_id: author.user_id,
    };
    accounts.add_contact(relationship).await.unwrap();
    let baseline = service.bootstrap(reader.clone()).await.unwrap();

    let outcome = accounts
        .delete_account(
            &author,
            DeleteAccount {
                operation_id: Uuid::new_v4(),
                confirm_shared_messages: true,
            },
        )
        .await
        .unwrap();
    assert!(matches!(outcome, AccountDeletionOutcome::Deleted(_)));
    assert!(cleanup_deleted_account(&pool).await.unwrap());
    for _ in 0..MAX_CLEANUP_ITERATIONS {
        if !cleanup_deleted_account(&pool).await.unwrap() {
            break;
        }
    }
    assert!(!cleanup_deleted_account(&pool).await.unwrap());

    let query = SyncQuery {
        cursor: baseline.cursor,
        limit: None,
    };
    let sync = service.sync(reader.clone(), query).await.unwrap();
    let conversation = sync.groups.last().unwrap().conversation.as_ref().unwrap();
    assert_eq!(conversation.id, shared.conversation.id);
    assert_eq!(conversation.peer_name, "Deleted account");
    assert_ne!(conversation.generation, shared.conversation.generation);
    let fresh = service.message(reader, shared.message.id).await.unwrap();
    assert_eq!(fresh.attachments[0].file.file_id, file_id);

    let saved_body = sqlx::query_scalar::<_, String>(
        "SELECT content->>'text' FROM messages WHERE id = $1 AND deleted_at IS NOT NULL",
    );
    assert_eq!(saved_body.bind(saved.message.id).fetch_one(&pool).await.unwrap(), "");
    let saved_has_file = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM media_message_references WHERE message_id = $1)",
    );
    assert!(!saved_has_file.bind(saved.message.id).fetch_one(&pool).await.unwrap());
    let has_private_membership = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM conversation_members WHERE user_id = $1)",
    );
    assert!(!has_private_membership.bind(author.user_id).fetch_one(&pool).await.unwrap());
    let evidence = sqlx::query_scalar::<_, Uuid>(
        "SELECT file_id FROM media_evidence_references WHERE case_id = $1 AND occurrence_id = $2",
    );
    let evidence = evidence.bind(receipt.case_id).bind(occurrence_id);
    assert_eq!(evidence.fetch_one(&pool).await.unwrap(), file_id);
}
