#[allow(dead_code)]
mod support;

use sqlx::PgPool;
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

fn test_upload_service(accounts: AccountService) -> tg_chat::media::UploadService {
    let endpoint = std::env::var("TG_CHAT_TEST_S3_ENDPOINT").unwrap();
    let settings = tg_chat::media::MediaStorageSettings {
        internal_endpoint: endpoint.clone(),
        public_endpoint: endpoint,
        access_key: std::env::var("TG_CHAT_TEST_S3_ACCESS_KEY").unwrap(),
        secret_key: std::env::var("TG_CHAT_TEST_S3_SECRET_KEY").unwrap(),
        browser_origin: "http://localhost:8080".to_owned(),
        // One bucket mirrors deployment and avoids allocating a SeaweedFS volume per test.
        bucket: "tg-chat-test-media".to_owned(),
    };
    tg_chat::media::UploadService::new(accounts, MediaLimits::default(), settings)
}

async fn put(request: &tg_chat::media::SignedUpload, bytes: Vec<u8>) -> reqwest::Response {
    let mut upload = reqwest::Client::new().put(&request.url);

    for (name, value) in &request.headers {
        upload = upload.header(name, value);
    }

    upload.body(bytes).send().await.unwrap()
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
