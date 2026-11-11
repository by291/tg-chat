#[allow(dead_code)]
mod support;

use sqlx::PgPool;
use support::media::{put, test_upload_service};
use tg_chat::{
    accounts::{AccountError, AccountService, AccountSettings},
    media::{MediaLimits, ReserveUpload, UploadPurpose, UploadReservations},
};
use uuid::Uuid;

const MEBIBYTE: i64 = 1024 * 1024;

fn document(size_bytes: i64) -> ReserveUpload {
    ReserveUpload {
        upload_id: Uuid::new_v4(),
        purpose: UploadPurpose::Document,
        file_name: "document.pdf".to_owned(),
        size_bytes,
        sha256: "a".repeat(64),
    }
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn reservation_replay_is_owner_bound_and_rejects_changed_payload(pool: PgPool) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let owner = support::account(&accounts, "upload_owner").await;
    let outsider = support::account(&accounts, "upload_outsider").await;
    let reservations = UploadReservations::new(accounts, MediaLimits::default());
    let request = document(MEBIBYTE);

    let first = reservations.reserve(&owner, request.clone()).await.unwrap();
    let replay = reservations.reserve(&owner, request.clone()).await.unwrap();
    assert_eq!(first, replay);

    let mut changed = request.clone();
    changed.size_bytes += 1;
    let conflict = reservations.reserve(&owner, changed).await;
    assert!(matches!(conflict, Err(AccountError::Conflict)));

    let foreign_status = reservations.status(&outsider, request.upload_id).await;
    assert!(matches!(foreign_status, Err(AccountError::NotFound)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn concurrent_reservations_share_the_account_byte_limit(pool: PgPool) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let actor = support::account(&accounts, "upload_owner").await;
    let limits = MediaLimits {
        account_bytes: 100 * MEBIBYTE,
        ..MediaLimits::default()
    };
    let reservations = UploadReservations::new(accounts, limits);

    let first = reservations.reserve(&actor, document(80 * MEBIBYTE));
    let second = reservations.reserve(&actor, document(80 * MEBIBYTE));
    let (first, second) = tokio::join!(first, second);

    assert_ne!(first.is_ok(), second.is_ok());
    let rejected = first.and(second);
    assert!(matches!(rejected, Err(AccountError::QuotaExceeded)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn cancelled_reservation_does_not_reopen_on_replay(pool: PgPool) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let actor = support::account(&accounts, "upload_owner").await;
    let reservations = UploadReservations::new(accounts, MediaLimits::default());
    let request = document(MEBIBYTE);

    reservations.reserve(&actor, request.clone()).await.unwrap();
    let cancelled = reservations.cancel(&actor, request.upload_id).await.unwrap();

    let replay = reservations.reserve(&actor, request).await.unwrap();
    assert_eq!(cancelled, replay);
    assert_ne!(replay.state, tg_chat::media::UploadState::Reserved);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and SeaweedFS"]
async fn transfer_reconciles_lost_part_and_completion_responses(pool: PgPool) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let actor = support::account(&accounts, "upload_owner").await;
    let service = test_upload_service(accounts);
    let request = document(9 * MEBIBYTE);
    let upload_id = request.upload_id;
    service.reserve(&actor, request).await.unwrap();

    let first = service.transfer(&actor, upload_id, vec![1, 2]).await.unwrap();
    let part = first.requests.first().unwrap();
    let stored = put(part, vec![17; 8 * MEBIBYTE as usize]).await;
    assert!(stored.status().is_success(), "{}", stored.status());

    let resumed = service.transfer(&actor, upload_id, vec![1, 2]).await.unwrap();
    assert_eq!(resumed.confirmed_parts, vec![1]);
    assert_eq!(resumed.requests.len(), 1);
    assert_eq!(resumed.requests[0].part_number, Some(2));

    let oversized_part = put(&resumed.requests[0], vec![19; MEBIBYTE as usize + 1]).await;
    assert!(oversized_part.status().is_client_error(), "{}", oversized_part.status());

    let final_part = put(&resumed.requests[0], vec![19; MEBIBYTE as usize]).await;
    assert!(final_part.status().is_success(), "{}", final_part.status());

    let accepted = service.complete(&actor, upload_id).await.unwrap();
    let replay = service.complete(&actor, upload_id).await.unwrap();
    assert_eq!(accepted.state, tg_chat::media::UploadState::Uploaded);
    assert_eq!(accepted, replay);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and SeaweedFS"]
async fn signed_single_put_rejects_bytes_beyond_the_reservation(pool: PgPool) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let actor = support::account(&accounts, "upload_owner").await;
    let service = test_upload_service(accounts);
    let request = document(4);
    let upload_id = request.upload_id;
    service.reserve(&actor, request).await.unwrap();

    let plan = service.transfer(&actor, upload_id, Vec::new()).await.unwrap();
    let signed = plan.requests.first().unwrap();
    let oversized = put(signed, vec![5; 5]).await;
    assert!(oversized.status().is_client_error(), "{}", oversized.status());

    let stored = put(signed, vec![5; 4]).await;
    assert!(stored.status().is_success(), "{}", stored.status());

    let recovered = service.transfer(&actor, upload_id, Vec::new()).await.unwrap();
    assert!(recovered.single_put_complete);
    assert!(recovered.requests.is_empty());
    let accepted = service.complete(&actor, upload_id).await.unwrap();
    assert_eq!(accepted.state, tg_chat::media::UploadState::Uploaded);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and SeaweedFS"]
async fn signed_transfer_supports_preflight_and_staging_stays_private(pool: PgPool) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let actor = support::account(&accounts, "upload_owner").await;
    let service = test_upload_service(accounts);
    let request = document(4);
    let upload_id = request.upload_id;
    service.reserve(&actor, request).await.unwrap();

    let plan = service.transfer(&actor, upload_id, Vec::new()).await.unwrap();
    let signed = plan.requests.first().unwrap();
    let client = reqwest::Client::new();
    let origin = "http://localhost:8080";
    let preflight = client.request(reqwest::Method::OPTIONS, &signed.url);
    let preflight = preflight.header("origin", origin);
    let preflight = preflight.header("access-control-request-method", "PUT");
    let response = preflight.send().await.unwrap();

    assert!(response.status().is_success(), "{}", response.status());
    assert_eq!(response.headers().get("access-control-allow-origin").unwrap(), origin);

    let stored = put(signed, vec![5; 4]).await;
    assert!(stored.status().is_success(), "{}", stored.status());

    let mut unsigned = url::Url::parse(&signed.url).unwrap();
    unsigned.set_query(None);
    let private = client.get(unsigned).send().await.unwrap();
    assert!(private.status().is_client_error(), "{}", private.status());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and SeaweedFS"]
async fn transfer_adopts_multipart_after_create_succeeds_before_recording(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let actor = support::account(&accounts, "upload_owner").await;
    let service = test_upload_service(accounts);
    let request = document(9 * MEBIBYTE);
    let upload_id = request.upload_id;
    service.reserve(&actor, request).await.unwrap();

    let initial = service.transfer(&actor, upload_id, vec![1]).await.unwrap();
    let uploaded = put(&initial.requests[0], vec![17; 8 * MEBIBYTE as usize]).await;
    assert!(uploaded.status().is_success());

    // Model a storage allocation whose ID was not durably recorded by the API.
    let forget = sqlx::query("UPDATE media_uploads SET multipart_id = NULL WHERE id = $1");
    forget.bind(upload_id).execute(&pool).await.unwrap();

    let recovered = service.transfer(&actor, upload_id, vec![1, 2]).await.unwrap();
    assert_eq!(recovered.confirmed_parts, vec![1]);
    assert_eq!(recovered.requests[0].part_number, Some(2));
}

async fn prepared_document(pool: &PgPool, actor: &tg_chat::accounts::Actor) -> Uuid {
    use sha2::{Digest, Sha256};
    use tg_chat::media::{MediaWorker, MediaWorkerSettings};

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let uploads = test_upload_service(accounts);
    let contents = b"a private document";
    let mut request = document(contents.len() as i64);
    request.sha256 = hex::encode(Sha256::digest(contents));
    let upload_id = request.upload_id;
    uploads.reserve(actor, request).await.unwrap();
    let plan = uploads.transfer(actor, upload_id, Vec::new()).await.unwrap();
    let stored = put(&plan.requests[0], contents.to_vec()).await;
    assert!(stored.status().is_success());
    uploads.complete(actor, upload_id).await.unwrap();
    let worker = MediaWorker::new(
        pool.clone(),
        support::media::storage_settings(),
        MediaWorkerSettings::default(),
    );
    assert!(worker.process_next().await.unwrap());

    uploads.status(actor, upload_id).await.unwrap().file_id.unwrap()
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and SeaweedFS"]
async fn an_owned_ready_file_can_be_sent_without_a_caption(pool: PgPool) {
    use tg_chat::{media::AttachmentInput, messages::MessageService};

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let sender = support::account(&accounts, "sender").await;
    let recipient = support::account(&accounts, "recipient").await;
    let file_id = prepared_document(&pool, &sender).await;
    let occurrence_id = Uuid::new_v4();
    let mut command = support::messaging::send_input(recipient.user_id);
    command.content.text.clear();
    command.attachments.push(AttachmentInput {
        occurrence_id,
        file_id,
    });

    let service = MessageService::new(accounts);
    let receipt = service.send(sender.clone(), command.clone()).await.unwrap();
    let replay = service.send(sender, command).await.unwrap();
    assert_eq!(receipt.message.id, replay.message.id);
    let visible = service.message(recipient, receipt.message.id).await.unwrap();
    assert_eq!(visible.attachments[0].occurrence_id, occurrence_id);
    assert_eq!(visible.attachments[0].file.file_id, file_id);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and SeaweedFS"]
async fn sending_a_foreign_ready_file_leaves_no_message(pool: PgPool) {
    use tg_chat::{media::AttachmentInput, messages::MessageService};

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "file_owner").await;
    let outsider = support::account(&accounts, "outsider").await;
    let file_id = prepared_document(&pool, &owner).await;
    let mut command = support::messaging::send_input(owner.user_id);
    command.attachments.push(AttachmentInput {
        occurrence_id: Uuid::new_v4(),
        file_id,
    });

    let message_id = command.message_id;
    let service = MessageService::new(accounts);
    let rejected = service.send(outsider, command).await;
    assert!(matches!(rejected, Err(AccountError::MediaFileUnavailable)));
    let accepted = service.message(owner, message_id).await;
    assert!(matches!(accepted, Err(AccountError::NotFound)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and SeaweedFS"]
async fn accepted_media_replays_after_its_file_is_collected(pool: PgPool) {
    use serde_json::json;
    use tg_chat::{media::AttachmentInput, messages::MessageService};

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let sender = support::account(&accounts, "sender").await;
    let recipient = support::account(&accounts, "recipient").await;
    let file_id = prepared_document(&pool, &sender).await;
    let mut command = support::messaging::send_input(recipient.user_id);
    command.attachments.push(AttachmentInput {
        occurrence_id: Uuid::new_v4(),
        file_id,
    });

    let service = MessageService::new(accounts);
    let first = service.send(sender.clone(), command.clone()).await.unwrap();
    let deletion = support::messaging::command(
        first.conversation.id,
        json!({
            "kind": "delete",
            "message_id": first.message.id,
        }),
    );
    service.command(sender.clone(), deletion).await.unwrap();

    // Model the successful terminal collection state until the collector is available.
    let collect = sqlx::query("UPDATE media_files SET deleted_at = now() WHERE id = $1");
    collect.bind(file_id).execute(&pool).await.unwrap();
    let replay = service.send(sender, command).await.unwrap();
    assert_eq!(replay.message.id, first.message.id);
    assert!(replay.message.is_deleted);
    assert!(replay.message.attachments.is_empty());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and SeaweedFS"]
async fn download_checks_reference_visibility_and_supports_range(pool: PgPool) {
    use serde_json::json;
    use tg_chat::{
        media::{AttachmentInput, DownloadReference, MediaVariant, MessageDownload},
        messages::MessageService,
    };

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let sender = support::account(&accounts, "sender").await;
    let recipient = support::account(&accounts, "recipient").await;
    let file_id = prepared_document(&pool, &sender).await;
    let occurrence_id = Uuid::new_v4();
    let mut command = support::messaging::send_input(recipient.user_id);
    command.attachments.push(AttachmentInput {
        occurrence_id,
        file_id,
    });

    let media = test_upload_service(accounts.clone());
    let messages = MessageService::new(accounts);
    let sent = messages.send(sender, command).await.unwrap();
    let reference = DownloadReference::Message(MessageDownload {
        message_id: sent.message.id,
        occurrence_id,
        variant: MediaVariant::Original,
    });
    let signed = media.sign_download(&recipient, reference).await.unwrap();
    let read = reqwest::Client::new().get(&signed.url).header("range", "bytes=0-3");
    let response = read.send().await.unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers().get("x-content-type-options").unwrap(), "nosniff");
    let disposition = response.headers().get("content-disposition").unwrap();
    assert!(disposition.to_str().unwrap().starts_with("attachment"));
    assert_eq!(response.bytes().await.unwrap().as_ref(), b"a pr");

    let hide = support::messaging::command(
        sent.conversation.id,
        json!({
            "kind": "hide_message",
            "message_id": sent.message.id,
        }),
    );
    messages.command(recipient.clone(), hide).await.unwrap();
    let blocked = media.sign_download(&recipient, reference).await;
    assert!(matches!(blocked, Err(AccountError::NotFound)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and SeaweedFS"]
async fn profile_avatar_does_not_authorize_the_original(pool: PgPool) {
    use tg_chat::media::{AvatarDownload, AvatarOwner, DownloadReference, MediaVariant, SetAvatar};

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "avatar_owner").await;
    let viewer = support::account(&accounts, "avatar_viewer").await;
    let file_id = prepared_document(&pool, &owner).await;

    // Use a ready avatar record to test reference permissions independently of codec availability.
    let purpose = sqlx::query("UPDATE media_uploads SET purpose = 'avatar' WHERE file_id = $1");
    purpose.bind(file_id).execute(&pool).await.unwrap();
    let thumbnail = sqlx::query(
        "INSERT INTO media_variants (file_id, kind, mime_type, size_bytes)
         VALUES ($1, 'thumbnail', 'image/jpeg', 4)",
    );
    thumbnail.bind(file_id).execute(&pool).await.unwrap();

    let profile = accounts.profile(&owner).await.unwrap();
    let updated = accounts
        .set_avatar(
            &owner,
            SetAvatar {
                operation_id: Uuid::new_v4(),
                expected_version: profile.version,
                file_id: Some(file_id),
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.avatar_file_id, Some(file_id));

    let media = test_upload_service(accounts);
    let reference = AvatarDownload {
        owner: AvatarOwner::User,
        owner_id: owner.user_id,
        variant: MediaVariant::Thumbnail,
    };
    assert!(media.sign_download(&viewer, DownloadReference::Avatar(reference)).await.is_ok());
    let original = AvatarDownload {
        variant: MediaVariant::Original,
        ..reference
    };
    let denied = media.sign_download(&viewer, DownloadReference::Avatar(original)).await;
    assert!(matches!(denied, Err(AccountError::NotFound)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and SeaweedFS"]
async fn album_preserves_repeated_file_occurrences_after_caption_edit(pool: PgPool) {
    use serde_json::json;
    use tg_chat::{media::AttachmentInput, messages::MessageService};

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let sender = support::account(&accounts, "sender").await;
    let recipient = support::account(&accounts, "recipient").await;
    let file_id = prepared_document(&pool, &sender).await;

    // This test exercises album identity independently of the Linux image codec.
    let image = sqlx::query("UPDATE media_uploads SET purpose = 'image' WHERE file_id = $1");
    image.bind(file_id).execute(&pool).await.unwrap();
    let occurrences = [Uuid::new_v4(), Uuid::new_v4()];
    let mut send = support::messaging::send_input(recipient.user_id);
    send.attachments = occurrences
        .iter()
        .map(|occurrence_id| AttachmentInput {
            occurrence_id: *occurrence_id,
            file_id,
        })
        .collect();

    let service = MessageService::new(accounts);
    let sent = service.send(sender.clone(), send).await.unwrap();
    let edit = support::messaging::command(
        sent.conversation.id,
        json!({
            "kind": "edit",
            "message_id": sent.message.id,
            "expected_version": sent.message.version,
            "content": {"schema_version": 1, "text": "", "custom_emoji": []}
        }),
    );
    service.command(sender, edit).await.unwrap();

    let edited = service.message(recipient, sent.message.id).await.unwrap();
    let order: Vec<Uuid> = edited.attachments.iter().map(|item| item.occurrence_id).collect();
    assert_eq!(order, occurrences);
    assert!(edited.content.text.is_empty());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and SeaweedFS"]
async fn publishing_consumes_the_upload_preview_authority(pool: PgPool) {
    use tg_chat::{
        media::{AttachmentInput, DownloadReference, MediaVariant},
        messages::MessageService,
    };

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let sender = support::account(&accounts, "sender").await;
    let recipient = support::account(&accounts, "recipient").await;
    let file_id = prepared_document(&pool, &sender).await;
    let upload_id = sqlx::query_scalar("SELECT id FROM media_uploads WHERE file_id = $1")
        .bind(file_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let preview = DownloadReference::Upload {
        upload_id,
        variant: MediaVariant::Original,
    };
    let media = test_upload_service(accounts.clone());
    assert!(media.sign_download(&sender, preview).await.is_ok());

    let mut input = support::messaging::send_input(recipient.user_id);
    input.attachments.push(AttachmentInput {
        occurrence_id: Uuid::new_v4(),
        file_id,
    });
    MessageService::new(accounts).send(sender.clone(), input).await.unwrap();

    let denied = media.sign_download(&sender, preview).await;
    assert!(matches!(denied, Err(AccountError::NotFound)));
}
