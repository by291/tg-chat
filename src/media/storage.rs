use std::{collections::BTreeMap, sync::Arc, time::Duration};

use aws_sdk_s3::{
    Client,
    config::retry::RetryConfig,
    config::{
        BehaviorVersion, Credentials, Region, RequestChecksumCalculation, timeout::TimeoutConfig,
    },
    presigning::PresigningConfig,
    primitives::ByteStream,
    types::{CompletedMultipartUpload, CompletedPart, CorsConfiguration, CorsRule},
};
use chrono::{DateTime, Utc};
use tokio::{io::AsyncWriteExt, sync::OnceCell};

use crate::accounts::AccountError;

use super::{MediaStorageSettings, SignedUpload, settings::WRITE_SECONDS};

const STORAGE_TIMEOUT: Duration = Duration::from_secs(10);
const REGION: &str = "us-east-1";

#[derive(Clone)]
pub(super) struct MediaStorage {
    internal: Client,
    signing: Client,
    bucket: String,
    browser_origin: String,
    provisioned: Arc<OnceCell<()>>,
}

pub(super) struct StoredPart {
    pub number: i32,
    pub size_bytes: i64,
    pub etag: String,
}

pub(super) struct UploadSignature<'a> {
    pub key: &'a str,
    pub size_bytes: i64,
    pub multipart: Option<MultipartPart<'a>>,
    pub issued_at: DateTime<Utc>,
}

pub(super) struct MultipartPart<'a> {
    pub upload_id: &'a str,
    pub number: i32,
}

pub(super) struct StoredSource<'a> {
    pub key: &'a str,
    pub path: &'a std::path::Path,
    pub size_bytes: i64,
}

pub(super) struct VariantObject<'a> {
    pub key: &'a str,
    pub path: &'a std::path::Path,
    pub size_bytes: i64,
    pub mime_type: &'a str,
}

fn client(settings: &MediaStorageSettings, endpoint: &str) -> Client {
    let credentials =
        Credentials::new(&settings.access_key, &settings.secret_key, None, None, "tg-chat");
    let timeout = TimeoutConfig::builder().operation_timeout(STORAGE_TIMEOUT).build();
    let config = aws_sdk_s3::Config::builder();
    let config = config.behavior_version(BehaviorVersion::latest());
    let config = config.credentials_provider(credentials).region(Region::new(REGION));
    let config = config.endpoint_url(endpoint).force_path_style(true).timeout_config(timeout);
    let config = config.request_checksum_calculation(RequestChecksumCalculation::WhenRequired);
    // Reconcile ambiguous multipart writes at the service boundary before retrying them.
    let config = config.retry_config(RetryConfig::disabled());
    Client::from_conf(config.build())
}

fn storage_unavailable(operation: &'static str) -> AccountError {
    // SDK errors can include signed request details. Log only the failed operation.
    tracing::warn!(operation, "media_storage_unavailable");
    AccountError::Unavailable
}

impl MediaStorage {
    /// Separate private S3 operations from browser-addressed signature creation.
    pub(super) fn new(settings: MediaStorageSettings) -> Self {
        Self {
            internal: client(&settings, &settings.internal_endpoint),
            signing: client(&settings, &settings.public_endpoint),
            bucket: settings.bucket,
            browser_origin: settings.browser_origin,
            provisioned: Arc::new(OnceCell::new()),
        }
    }

    /// Prepare the private bucket and the browser's upload and read CORS rules.
    pub(super) async fn provision(&self) -> Result<(), AccountError> {
        self.provisioned.get_or_try_init(|| self.provision_bucket()).await?;

        Ok(())
    }

    async fn provision_bucket(&self) -> Result<(), AccountError> {
        let result = self.internal.head_bucket().bucket(&self.bucket).send().await;
        if let Err(error) = result {
            let is_missing = error.as_service_error().is_some_and(|error| error.is_not_found());
            if !is_missing {
                return Err(storage_unavailable("head_bucket"));
            }
            self.create_bucket().await?;
        }

        let rule = CorsRule::builder();
        let rule = rule.allowed_origins(&self.browser_origin).allowed_headers("*");
        let rule = rule.allowed_methods("PUT").allowed_methods("GET").allowed_methods("HEAD");
        let rule = rule.expose_headers("ETag").expose_headers("Content-Range");
        let rule = rule.build().map_err(|_| storage_unavailable("build_cors_rule"))?;
        let cors = CorsConfiguration::builder().cors_rules(rule);
        let cors = cors.build().map_err(|_| storage_unavailable("build_cors_configuration"))?;
        let request = self.internal.put_bucket_cors().bucket(&self.bucket);
        let request = request.cors_configuration(cors);
        request.send().await.map_err(|_| storage_unavailable("put_bucket_cors"))?;

        Ok(())
    }

    async fn create_bucket(&self) -> Result<(), AccountError> {
        let result = self.internal.create_bucket().bucket(&self.bucket).send().await;
        if let Err(error) = result {
            let is_owned = error
                .as_service_error()
                .is_some_and(|error| error.is_bucket_already_owned_by_you());
            if !is_owned {
                return Err(storage_unavailable("create_bucket"));
            }
        }

        Ok(())
    }

    /// Recover a completed object by its exact size even after a lost response.
    pub(super) async fn object_size(&self, key: &str) -> Result<Option<i64>, AccountError> {
        let request = self.internal.head_object().bucket(&self.bucket).key(key);
        match request.send().await {
            Ok(object) => object
                .content_length()
                .map(Some)
                .ok_or_else(|| storage_unavailable("missing_object_size")),
            Err(error) if error.as_service_error().is_some_and(|error| error.is_not_found()) => {
                Ok(None)
            }
            Err(_) => Err(storage_unavailable("head_object")),
        }
    }

    /// Discover an upload whose create response may have disappeared before allocating another.
    pub(super) async fn multipart_id(&self, key: &str) -> Result<String, AccountError> {
        let list = self.internal.list_multipart_uploads().bucket(&self.bucket).prefix(key);
        let uploads = list.send().await.map_err(|_| storage_unavailable("list_uploads"))?;
        for upload in uploads.uploads() {
            if upload.key() != Some(key) {
                continue;
            }
            if let Some(id) = upload.upload_id() {
                return Ok(id.to_owned());
            }
        }
        if uploads.is_truncated().unwrap_or(false) {
            return Err(storage_unavailable("list_uploads_truncated"));
        }

        let create = self.internal.create_multipart_upload().bucket(&self.bucket).key(key);
        let output = create.send().await.map_err(|_| storage_unavailable("create_multipart"))?;
        let upload_id =
            output.upload_id().ok_or_else(|| storage_unavailable("missing_upload_id"))?;

        Ok(upload_id.to_owned())
    }

    /// Read part identities from storage so acknowledgements can be recovered after reload.
    pub(super) async fn parts(
        &self,
        key: &str,
        upload_id: &str,
    ) -> Result<Vec<StoredPart>, AccountError> {
        let request = self.internal.list_parts().bucket(&self.bucket).key(key);
        let request = request.upload_id(upload_id);
        let output = request.send().await.map_err(|_| storage_unavailable("list_parts"))?;
        if output.is_truncated().unwrap_or(false) {
            return Err(storage_unavailable("list_parts_truncated"));
        }

        let mut parts = Vec::with_capacity(output.parts().len());
        for part in output.parts() {
            let (Some(number), Some(size_bytes), Some(etag)) =
                (part.part_number(), part.size(), part.e_tag())
            else {
                return Err(storage_unavailable("incomplete_part_metadata"));
            };

            parts.push(StoredPart {
                number,
                size_bytes,
                etag: etag.to_owned(),
            });
        }
        parts.sort_unstable_by_key(|part| part.number);

        Ok(parts)
    }

    /// Commit the exact parts confirmed by storage in ascending order.
    pub(super) async fn complete(
        &self,
        key: &str,
        upload_id: &str,
        parts: Vec<StoredPart>,
    ) -> Result<(), AccountError> {
        let mut completed = Vec::with_capacity(parts.len());
        for part in parts {
            let builder = CompletedPart::builder().part_number(part.number).e_tag(part.etag);
            completed.push(builder.build());
        }

        let upload = CompletedMultipartUpload::builder().set_parts(Some(completed)).build();
        let request = self.internal.complete_multipart_upload().bucket(&self.bucket).key(key);
        let request = request.upload_id(upload_id).multipart_upload(upload);
        request.send().await.map_err(|_| storage_unavailable("complete_multipart"))?;

        Ok(())
    }

    /// Sign one exact-length PUT with the host the browser will contact.
    pub(super) async fn sign(
        &self,
        input: UploadSignature<'_>,
    ) -> Result<SignedUpload, AccountError> {
        let duration = Duration::from_secs(WRITE_SECONDS as u64);
        let config = PresigningConfig::builder().expires_in(duration);
        let config = config.start_time(input.issued_at.into());
        let config = config.build().map_err(|_| storage_unavailable("presigning_configuration"))?;
        let part_number = input.multipart.as_ref().map(|part| part.number);
        let request = match input.multipart {
            Some(part) => {
                let request = self.signing.upload_part().bucket(&self.bucket).key(input.key);
                let request = request.upload_id(part.upload_id).part_number(part.number);
                let request = request.content_length(input.size_bytes);
                request
                    .presigned(config)
                    .await
                    .map_err(|_| storage_unavailable("sign_upload_part"))?
            }
            None => {
                let request = self.signing.put_object().bucket(&self.bucket).key(input.key);
                let request = request.content_length(input.size_bytes);
                request
                    .presigned(config)
                    .await
                    .map_err(|_| storage_unavailable("sign_put_object"))?
            }
        };

        let mut headers = BTreeMap::new();
        for (name, value) in request.headers() {
            // The browser supplies Host and the exact Blob length through its HTTP transport.
            if !matches!(name, "host" | "content-length") {
                headers.insert(name.to_owned(), value.to_owned());
            }
        }

        Ok(SignedUpload {
            url: request.uri().to_owned(),
            headers,
            part_number,
            expires_at: input.issued_at + chrono::Duration::seconds(WRITE_SECONDS),
        })
    }

    /// Copy staging into a fresh server-owned attempt namespace.
    pub(super) async fn copy_candidate(
        &self,
        source_key: &str,
        candidate_key: &str,
    ) -> Result<(), AccountError> {
        let source = format!("{}/{source_key}", self.bucket);
        let request = self.internal.copy_object().bucket(&self.bucket).key(candidate_key);
        let request = request.copy_source(source);
        request.send().await.map_err(|_| storage_unavailable("copy_candidate"))?;

        Ok(())
    }

    /// Stream the candidate to scratch while bounding the bytes read.
    pub(super) async fn download_candidate(
        &self,
        source: StoredSource<'_>,
    ) -> Result<String, AccountError> {
        use sha2::{Digest, Sha256};

        let request = self.internal.get_object().bucket(&self.bucket).key(source.key);
        let result = request.send().await.map_err(|_| storage_unavailable("get_candidate"))?;
        if result.content_length() != Some(source.size_bytes) {
            return Err(AccountError::Validation("size_mismatch"));
        }

        let mut file = tokio::fs::File::create(source.path)
            .await
            .map_err(|_| storage_unavailable("open_candidate_scratch"))?;
        let mut remaining = source.size_bytes;
        let mut hash = Sha256::new();
        let mut body = result.body;
        while let Some(chunk) = body.next().await {
            let chunk = chunk.map_err(|_| storage_unavailable("read_candidate"))?;
            remaining -= chunk.len() as i64;
            if remaining < 0 {
                return Err(AccountError::Validation("size_mismatch"));
            }
            hash.update(&chunk);
            file.write_all(&chunk).await.map_err(|_| storage_unavailable("write_candidate"))?;
        }
        if remaining != 0 {
            return Err(AccountError::Validation("size_mismatch"));
        }

        Ok(hex::encode(hash.finalize()))
    }

    /// Persist a bounded derivative under its attempt's private key.
    pub(super) async fn put_variant(&self, variant: VariantObject<'_>) -> Result<(), AccountError> {
        let body = ByteStream::from_path(variant.path)
            .await
            .map_err(|_| storage_unavailable("open_variant"))?;
        let request = self.internal.put_object().bucket(&self.bucket).key(variant.key);
        let request = request.body(body).content_length(variant.size_bytes);
        let request = request.content_type(variant.mime_type);
        request.send().await.map_err(|_| storage_unavailable("put_variant"))?;

        Ok(())
    }
}
