use tg_chat::{
    accounts::AccountService,
    media::{MediaLimits, MediaStorageSettings, SignedUpload, UploadService},
};

/// Point media tests at an isolated SeaweedFS deployment.
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
        // One bucket mirrors deployment and avoids allocating a SeaweedFS volume per test.
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
