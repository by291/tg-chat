#[allow(dead_code)]
mod support;

use sha2::{Digest, Sha256};
use sqlx::PgPool;
use support::media::{put, storage_settings, test_upload_service};
use tg_chat::features::{
    accounts::{AccountService, AccountSettings, Actor},
    media::{MediaWorker, MediaWorkerSettings, ReserveUpload, SignedUpload, UploadPurpose},
    media::{UploadService, UploadState},
};
use uuid::Uuid;

const FILE_BYTES: &[u8] = b"opaque attachment";
const REPLACEMENT_BYTES: &[u8] = b"replacement bytes";

async fn transfer_document(service: &UploadService, actor: &Actor) -> SignedUpload {
    let request = ReserveUpload {
        upload_id: Uuid::new_v4(),
        purpose: UploadPurpose::Document,
        file_name: "document.txt".to_owned(),
        size_bytes: FILE_BYTES.len() as i64,
        sha256: hex::encode(Sha256::digest(FILE_BYTES)),
    };
    let upload_id = request.upload_id;
    service.reserve(actor, request).await.unwrap();
    let transfer = service.transfer(actor, upload_id, Vec::new()).await.unwrap();
    let signed = transfer.requests.into_iter().next().unwrap();

    let stored = put(&signed, FILE_BYTES.to_vec()).await;
    assert!(stored.status().is_success());
    service.complete(actor, upload_id).await.unwrap();

    signed
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and S3 storage"]
async fn staging_overwrite_cannot_publish_unverified_bytes(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let actor = support::account(&accounts, "file_owner").await;
    let uploads = test_upload_service(accounts);
    let signed = transfer_document(&uploads, &actor).await;
    let overwrite = put(&signed, REPLACEMENT_BYTES.to_vec()).await;
    assert!(overwrite.status().is_success());

    let worker = MediaWorker::new(pool.clone(), storage_settings(), MediaWorkerSettings::default());
    assert!(worker.process_next().await.unwrap());
    let rejected = sqlx::query_as::<_, (UploadState, Option<String>)>(
        "SELECT state, error_code FROM media_uploads WHERE owner_id = $1",
    )
    .bind(actor.user_id);
    let rejected = rejected.fetch_one(&pool).await.unwrap();
    assert_eq!(rejected, (UploadState::Rejected, Some("digest_mismatch".to_owned())));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and S3 storage"]
async fn prepared_document_keeps_the_same_file_after_worker_restart(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let actor = support::account(&accounts, "file_owner").await;
    let uploads = test_upload_service(accounts);
    transfer_document(&uploads, &actor).await;

    let settings = MediaWorkerSettings::default();
    let worker = MediaWorker::new(pool.clone(), storage_settings(), settings.clone());
    assert!(worker.process_next().await.unwrap());

    let published = || {
        sqlx::query_as::<_, (UploadState, Option<Uuid>)>(
            "SELECT state, file_id FROM media_uploads WHERE owner_id = $1",
        )
        .bind(actor.user_id)
    };
    let first = published().fetch_one(&pool).await.unwrap();
    assert_eq!(first.0, UploadState::Ready);
    assert!(first.1.is_some());

    let restarted = MediaWorker::new(pool.clone(), storage_settings(), settings);
    assert!(!restarted.process_next().await.unwrap());
    assert_eq!(published().fetch_one(&pool).await.unwrap(), first);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and S3 storage"]
async fn restarted_worker_can_take_over_only_after_lease_expiry(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let actor = support::account(&accounts, "file_owner").await;
    let uploads = test_upload_service(accounts);
    transfer_document(&uploads, &actor).await;

    let first_lease = Uuid::new_v4();
    let stalled = sqlx::query(
        "UPDATE media_preparation_jobs
         SET lease_id = $1, lease_until = now() + interval '1 minute', attempts = 1",
    )
    .bind(first_lease);
    stalled.execute(&pool).await.unwrap();

    let worker = MediaWorker::new(pool.clone(), storage_settings(), MediaWorkerSettings::default());
    assert!(!worker.process_next().await.unwrap());

    let expire = sqlx::query("UPDATE media_preparation_jobs SET lease_until = now()");
    expire.execute(&pool).await.unwrap();
    assert!(worker.process_next().await.unwrap());

    let published: Uuid =
        sqlx::query_scalar("SELECT id FROM media_files").fetch_one(&pool).await.unwrap();
    assert_ne!(published, first_lease);
    assert!(!worker.process_next().await.unwrap());
}

#[cfg(target_os = "linux")]
fn codec_fixture(kind: UploadPurpose, source_override: Option<&str>) -> Vec<u8> {
    use std::process::Command;

    let scratch = tempfile::tempdir().unwrap();
    let (name, input) = match kind {
        UploadPurpose::Image => ("frame.png", "color=c=blue:s=64x48"),
        UploadPurpose::Video => ("clip.mp4", "testsrc=size=64x48:rate=10"),
        UploadPurpose::Voice => ("voice.wav", "sine=frequency=440:sample_rate=16000"),
        _ => panic!("unsupported codec fixture"),
    };
    let input = source_override.unwrap_or(input);
    let output = scratch.path().join(name);
    let mut command = Command::new("/usr/bin/ffmpeg");
    command.args(["-v", "error", "-f", "lavfi", "-i", input]);
    command.args(["-t", "1", "-threads", "1"]);
    if kind == UploadPurpose::Image {
        command.args(["-frames:v", "1"]);
    }
    command.arg(&output);
    assert!(command.status().unwrap().success());

    std::fs::read(output).unwrap()
}

#[cfg(target_os = "linux")]
async fn complete_codec_upload(
    uploads: &UploadService,
    actor: &Actor,
    fixture: CodecFixture,
) -> Uuid {
    let request = ReserveUpload {
        upload_id: Uuid::new_v4(),
        purpose: fixture.kind,
        file_name: "fixture".to_owned(),
        size_bytes: fixture.bytes.len() as i64,
        sha256: hex::encode(Sha256::digest(&fixture.bytes)),
    };
    let upload_id = request.upload_id;
    uploads.reserve(actor, request).await.unwrap();
    let transfer = uploads.transfer(actor, upload_id, Vec::new()).await.unwrap();
    let stored = put(&transfer.requests[0], fixture.bytes).await;
    assert!(stored.status().is_success());
    uploads.complete(actor, upload_id).await.unwrap();

    upload_id
}

#[cfg(target_os = "linux")]
struct CodecFixture {
    kind: UploadPurpose,
    bytes: Vec<u8>,
}

#[cfg(target_os = "linux")]
fn linux_worker(pool: PgPool) -> MediaWorker {
    let settings = MediaWorkerSettings {
        processor: env!("CARGO_BIN_EXE_media-processor").into(),
        ..MediaWorkerSettings::default()
    };
    MediaWorker::new(pool, storage_settings(), settings)
}

#[cfg(target_os = "linux")]
#[sqlx::test]
#[ignore = "requires PostgreSQL, S3 storage, and the Linux processor"]
async fn processor_publishes_real_image_video_and_voice_derivatives(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let actor = support::account(&accounts, "file_owner").await;
    let uploads = test_upload_service(accounts);
    let worker = linux_worker(pool.clone());
    let formats = [(UploadPurpose::Image, 2), (UploadPurpose::Video, 3), (UploadPurpose::Voice, 2)];

    for (kind, expected_variant_count) in formats {
        let fixture = CodecFixture {
            kind,
            bytes: codec_fixture(kind, None),
        };
        let upload_id = complete_codec_upload(&uploads, &actor, fixture).await;
        assert!(worker.process_next().await.unwrap());
        let status = uploads.status(&actor, upload_id).await.unwrap();
        assert_eq!(status.state, UploadState::Ready, "{status:?}");

        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM media_variants WHERE file_id = $1")
                .bind(status.file_id.unwrap())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, expected_variant_count);
    }
}

#[cfg(target_os = "linux")]
#[test]
#[ignore = "requires the Linux media toolchain"]
fn processor_denies_network_access() {
    use std::{net::TcpListener, process::Command};

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let source = format!("http://{}", listener.local_addr().unwrap());
    let mut command = Command::new(env!("CARGO_BIN_EXE_media-processor"));
    command.args(["ffprobe", "-v", "error", "-rw_timeout", "500000", &source]);

    let output = command.output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    let diagnostic = String::from_utf8_lossy(&output.stderr);
    assert!(diagnostic.contains("Operation not permitted"), "{diagnostic}");
}

#[cfg(target_os = "linux")]
#[sqlx::test]
#[ignore = "requires PostgreSQL, S3 storage, and the Linux processor"]
async fn processor_rejects_images_over_the_pixel_budget(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let actor = support::account(&accounts, "file_owner").await;
    let uploads = test_upload_service(accounts);
    let kind = UploadPurpose::Image;
    let fixture = CodecFixture {
        kind,
        bytes: codec_fixture(kind, Some("color=c=blue:s=8200x5000")),
    };
    let upload_id = complete_codec_upload(&uploads, &actor, fixture).await;

    let worker = linux_worker(pool);
    assert!(worker.process_next().await.unwrap());
    let status = uploads.status(&actor, upload_id).await.unwrap();
    assert_eq!(status.state, UploadState::Rejected);
    assert_eq!(status.error_code.as_deref(), Some("image_dimension_limit"));
    assert!(status.file_id.is_none());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and S3 storage"]
async fn collector_preserves_a_file_with_a_live_message_reference(pool: PgPool) {
    use tg_chat::features::{
        media::{AttachmentInput, DownloadReference, MediaCleanup, MediaVariant, MessageDownload},
        messages::MessageService,
    };

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let sender = support::account(&accounts, "sender").await;
    let recipient = support::account(&accounts, "recipient").await;
    let uploads = test_upload_service(accounts.clone());
    transfer_document(&uploads, &sender).await;
    let worker = MediaWorker::new(pool.clone(), storage_settings(), MediaWorkerSettings::default());
    assert!(worker.process_next().await.unwrap());

    let file_id: Uuid =
        sqlx::query_scalar("SELECT id FROM media_files").fetch_one(&pool).await.unwrap();
    let occurrence_id = Uuid::new_v4();
    let mut input = support::messaging::send_input(recipient.user_id);
    input.attachments.push(AttachmentInput {
        occurrence_id,
        file_id,
    });
    let messages = MessageService::new(accounts);
    let sent = messages.send(sender, input).await.unwrap();

    let cleanup = MediaCleanup::new(pool, storage_settings());
    cleanup.process_next().await.unwrap();

    let reference = DownloadReference::Message(MessageDownload {
        message_id: sent.message.id,
        occurrence_id,
        variant: MediaVariant::Original,
    });
    let signed = uploads.sign_download(&recipient, reference).await.unwrap();
    let stored = reqwest::get(signed.url).await.unwrap();
    assert!(stored.status().is_success());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and S3 storage"]
async fn staging_cleanup_waits_for_a_signed_write_to_expire(pool: PgPool) {
    use tg_chat::features::media::MediaCleanup;

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let actor = support::account(&accounts, "file_owner").await;
    let uploads = test_upload_service(accounts);
    let signed = transfer_document(&uploads, &actor).await;
    let upload_id: Uuid =
        sqlx::query_scalar("SELECT id FROM media_uploads").fetch_one(&pool).await.unwrap();
    uploads.cancel(&actor, upload_id).await.unwrap();
    let cleanup = MediaCleanup::new(pool.clone(), storage_settings());
    assert!(!cleanup.process_next().await.unwrap());
    let late_write = put(&signed, FILE_BYTES.to_vec()).await;
    assert!(late_write.status().is_success());

    // Move the accounting deadlines back without changing the test runner's wall clock.
    let expire = sqlx::query(
        "UPDATE media_uploads SET last_write_expires_at = now() - interval '1 hour',
             cleanup_after = now()",
    );
    expire.execute(&pool).await.unwrap();
    assert!(cleanup.process_next().await.unwrap());
    let released: bool =
        sqlx::query_scalar("SELECT released_at IS NOT NULL FROM media_uploads WHERE id = $1")
            .bind(upload_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(released);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL and S3 storage"]
async fn retry_waits_for_the_previous_candidate_to_release_its_bytes(pool: PgPool) {
    use tg_chat::features::media::MediaCleanup;

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let actor = support::account(&accounts, "file_owner").await;
    let uploads = test_upload_service(accounts);
    transfer_document(&uploads, &actor).await;
    let abandoned = sqlx::query(
        "INSERT INTO media_processing_attempts (id, upload_id, created_at)
         SELECT $1, id, now() - interval '1 hour' FROM media_uploads",
    );
    abandoned.bind(Uuid::new_v4()).execute(&pool).await.unwrap();

    let worker = MediaWorker::new(pool.clone(), storage_settings(), MediaWorkerSettings::default());
    assert!(!worker.process_next().await.unwrap());

    let cleanup = MediaCleanup::new(pool, storage_settings());
    assert!(cleanup.process_next().await.unwrap());
    assert!(worker.process_next().await.unwrap());
}
