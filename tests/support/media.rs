use sqlx::PgPool;
use tg_chat::{
    accounts::{AccountService, AccountSettings},
    media::{MediaLimits, MediaStorageSettings, SignedUpload, UploadService},
};
use uuid::Uuid;

/// Point media tests at an isolated S3 storage deployment.
pub fn storage_settings() -> MediaStorageSettings {
    let internal_endpoint = std::env::var("TG_CHAT_TEST_S3_ENDPOINT").unwrap();
    let public_endpoint = std::env::var("TG_CHAT_TEST_S3_PUBLIC_ENDPOINT")
        .unwrap_or_else(|_| internal_endpoint.clone());

    MediaStorageSettings {
        internal_endpoint,
        public_endpoint,
        access_key: std::env::var("TG_CHAT_TEST_S3_ACCESS_KEY").unwrap(),
        secret_key: std::env::var("TG_CHAT_TEST_S3_SECRET_KEY").unwrap(),
        browser_origin: "http://localhost:8080".to_owned(),
        // One bucket mirrors deployment and shares CORS configuration across test cases.
        bucket: "tg-chat-test-media".to_owned(),
    }
}

/// Construct the production upload service against the test database and bucket.
pub fn test_upload_service(accounts: AccountService) -> UploadService {
    UploadService::new(accounts, MediaLimits::default(), storage_settings())
}

/// Upload with browser-equivalent length and the required signed headers.
pub async fn put(request: &SignedUpload, bytes: Vec<u8>) -> reqwest::Response {
    let mut upload = reqwest::Client::new().put(&request.url);

    for (name, value) in &request.headers {
        upload = upload.header(name, value);
    }

    upload.body(bytes).send().await.unwrap()
}

/// Prepare a small document through the real upload and Worker paths.
pub async fn prepared_document(pool: &PgPool, actor: &tg_chat::accounts::Actor) -> Uuid {
    use sha2::{Digest, Sha256};
    use tg_chat::media::{MediaWorker, MediaWorkerSettings, ReserveUpload, UploadPurpose};

    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let uploads = test_upload_service(accounts);
    let contents = b"a private document";
    let request = ReserveUpload {
        upload_id: Uuid::new_v4(),
        purpose: UploadPurpose::Document,
        file_name: "document.pdf".to_owned(),
        size_bytes: contents.len() as i64,
        sha256: hex::encode(Sha256::digest(contents)),
    };
    let upload_id = request.upload_id;
    uploads.reserve(actor, request).await.unwrap();
    let plan = uploads.transfer(actor, upload_id, Vec::new()).await.unwrap();
    let stored = put(&plan.requests[0], contents.to_vec()).await;
    assert!(stored.status().is_success());
    uploads.complete(actor, upload_id).await.unwrap();
    let worker = MediaWorker::new(pool.clone(), storage_settings(), MediaWorkerSettings::default());
    assert!(worker.process_next().await.unwrap());

    uploads.status(actor, upload_id).await.unwrap().file_id.unwrap()
}
