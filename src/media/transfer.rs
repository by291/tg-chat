use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::accounts::{AccountError, AccountService, Actor, sessions::lock_actor};

use super::{
    MediaLimits, MediaStorageSettings, ReserveUpload, TransferPlan, UploadReservations,
    UploadState, UploadStatus,
    model::UploadRecord,
    settings::{CLAIM_SECONDS, MAX_TRANSFER_PARTS, PART_BYTES, RESERVATION_SECONDS, WRITE_SECONDS},
    storage::{MediaStorage, MultipartPart, StoredPart, UploadSignature},
};

#[derive(Clone)]
pub struct UploadService {
    reservations: UploadReservations,
    storage: MediaStorage,
}

enum ClaimOutcome {
    Active(TransferClaim),
    Settled(UploadStatus),
}

struct TransferClaim {
    token: Uuid,
    upload: UploadRecord,
}

struct PlannedTransfer {
    plan: TransferPlan,
    multipart_id: Option<String>,
    signed_at: DateTime<Utc>,
}

/// Derive the staging object key from the reserved upload identity.
pub(super) fn staging_key(upload_id: Uuid) -> String {
    format!("staging/{upload_id}")
}

fn part_count(size_bytes: i64) -> i32 {
    ((size_bytes + PART_BYTES - 1) / PART_BYTES) as i32
}

fn part_size(size_bytes: i64, number: i32) -> i64 {
    let offset = i64::from(number - 1) * PART_BYTES;
    (size_bytes - offset).min(PART_BYTES)
}

fn validate_parts(parts: &[StoredPart], size_bytes: i64) -> Result<(), AccountError> {
    let valid_numbers = 1..=part_count(size_bytes);
    let mut previous_number = 0;
    for part in parts {
        let is_valid = valid_numbers.contains(&part.number)
            && part.number > previous_number
            && part.size_bytes == part_size(size_bytes, part.number);
        if !is_valid {
            return Err(AccountError::Validation("stored part does not match its allocation"));
        }
        previous_number = part.number;
    }

    Ok(())
}

impl UploadService {
    /// Combine PostgreSQL reservations with the private object store.
    pub fn new(
        accounts: AccountService,
        limits: MediaLimits,
        settings: MediaStorageSettings,
    ) -> Self {
        Self {
            reservations: UploadReservations::new(accounts, limits),
            storage: MediaStorage::new(settings),
        }
    }

    /// Reserve the bytes and stable identity needed for an upload.
    pub async fn reserve(
        &self,
        actor: &Actor,
        request: ReserveUpload,
    ) -> Result<UploadStatus, AccountError> {
        self.reservations.reserve(actor, request).await
    }

    /// Read an upload's state within its owning session.
    pub async fn status(
        &self,
        actor: &Actor,
        upload_id: Uuid,
    ) -> Result<UploadStatus, AccountError> {
        self.reservations.status(actor, upload_id).await
    }

    /// Stop further transfer authorization and retain cleanup ownership.
    pub async fn cancel(
        &self,
        actor: &Actor,
        upload_id: Uuid,
    ) -> Result<UploadStatus, AccountError> {
        self.reservations.cancel(actor, upload_id).await
    }

    /// Reconcile stored parts and sign only requested parts that are still missing.
    pub async fn transfer(
        &self,
        actor: &Actor,
        upload_id: Uuid,
        mut requested: Vec<i32>,
    ) -> Result<TransferPlan, AccountError> {
        if requested.len() > MAX_TRANSFER_PARTS {
            return Err(AccountError::Validation("too many requested upload parts"));
        }
        requested.sort_unstable();
        requested.dedup();

        let claim = self.claim(actor, upload_id).await?;
        let ClaimOutcome::Active(claim) = claim else {
            return Err(AccountError::Conflict);
        };

        let result = self.plan_transfer(&claim.upload, requested).await;
        let transfer = match result {
            Ok(transfer) => transfer,
            Err(error) => {
                self.release_claim(&claim).await;
                return Err(error);
            }
        };

        self.record_transfer(actor, &claim, &transfer).await?;

        Ok(transfer.plan)
    }

    /// Verify the complete staging object and enqueue preparation exactly once.
    pub async fn complete(
        &self,
        actor: &Actor,
        upload_id: Uuid,
    ) -> Result<UploadStatus, AccountError> {
        let claim = match self.claim(actor, upload_id).await? {
            ClaimOutcome::Active(claim) => claim,
            ClaimOutcome::Settled(status) => return Ok(status),
        };
        if let Err(error) = self.verify_complete(&claim.upload).await {
            self.release_claim(&claim).await;
            return Err(error);
        }

        self.queue_preparation(actor, claim).await
    }

    async fn claim(&self, actor: &Actor, upload_id: Uuid) -> Result<ClaimOutcome, AccountError> {
        let accounts = &self.reservations.accounts;
        let mut transaction = accounts.pool.begin().await?;
        lock_actor(&mut transaction, actor, &accounts.settings).await?;
        // Release database locks before S3 calls; the token fences late or cancelled attempts.
        let token = Uuid::new_v4();
        let claim = sqlx::query_as::<_, UploadRecord>(
            "UPDATE media_uploads SET claim_id = $4,
                 claim_until = now() + ($5::bigint * interval '1 second')
             WHERE id = $1 AND owner_id = $2 AND session_id = $3
               AND state = 'reserved' AND expires_at > now()
               AND (claim_until IS NULL OR claim_until <= now())
             RETURNING *, false AS is_expired",
        )
        .bind(upload_id)
        .bind(actor.user_id)
        .bind(actor.session_id);
        let claim = claim.bind(token).bind(CLAIM_SECONDS);
        let upload = claim.fetch_optional(&mut *transaction).await?;
        if let Some(upload) = upload {
            transaction.commit().await?;
            return Ok(ClaimOutcome::Active(TransferClaim {
                token,
                upload,
            }));
        }

        let upload = super::uploads::find_owned(&mut transaction, actor, upload_id).await?;
        let upload = upload.ok_or(AccountError::NotFound)?;
        if upload.state == UploadState::Reserved && !upload.is_expired {
            return Err(AccountError::Conflict);
        }

        Ok(ClaimOutcome::Settled(upload.status()))
    }

    async fn release_claim(&self, claim: &TransferClaim) {
        let update = sqlx::query(
            "UPDATE media_uploads SET claim_id = NULL, claim_until = NULL
             WHERE id = $1 AND claim_id = $2",
        )
        .bind(claim.upload.id)
        .bind(claim.token);
        if update.execute(&self.reservations.accounts.pool).await.is_err() {
            tracing::warn!("media_transfer_claim_will_expire");
        }
    }

    async fn plan_transfer(
        &self,
        upload: &UploadRecord,
        requested: Vec<i32>,
    ) -> Result<PlannedTransfer, AccountError> {
        self.storage.provision().await?;
        let key = staging_key(upload.id);
        let is_complete = self.has_complete_object(upload, &key).await?;
        let signed_at = Utc::now();

        if upload.size_bytes <= PART_BYTES {
            if !requested.is_empty() {
                return Err(AccountError::Validation("single PUT does not accept part numbers"));
            }

            let plan = self.plan_single(upload, &key, is_complete, signed_at).await?;
            return Ok(PlannedTransfer {
                plan,
                multipart_id: None,
                signed_at,
            });
        }

        let part_numbers = 1..=part_count(upload.size_bytes);
        if !requested.iter().all(|number| part_numbers.contains(number)) {
            return Err(AccountError::Validation("invalid upload part number"));
        }
        if is_complete {
            return Ok(PlannedTransfer {
                plan: TransferPlan {
                    confirmed_parts: part_numbers.collect(),
                    ..TransferPlan::default()
                },
                multipart_id: upload.multipart_id.clone(),
                signed_at,
            });
        }

        self.plan_multipart(upload, &key, requested).await
    }

    async fn has_complete_object(
        &self,
        upload: &UploadRecord,
        key: &str,
    ) -> Result<bool, AccountError> {
        match self.storage.object_size(key).await? {
            Some(size) if size == upload.size_bytes => Ok(true),
            Some(_) => {
                Err(AccountError::Validation("stored object size does not match reservation"))
            }
            None => Ok(false),
        }
    }

    async fn plan_single(
        &self,
        upload: &UploadRecord,
        key: &str,
        is_complete: bool,
        signed_at: DateTime<Utc>,
    ) -> Result<TransferPlan, AccountError> {
        if is_complete {
            return Ok(TransferPlan {
                single_put_complete: true,
                ..TransferPlan::default()
            });
        }

        let signature = self.storage.sign(UploadSignature {
            key,
            size_bytes: upload.size_bytes,
            multipart: None,
            issued_at: signed_at,
        });
        let request = signature.await?;

        Ok(TransferPlan {
            requests: vec![request],
            ..TransferPlan::default()
        })
    }

    async fn plan_multipart(
        &self,
        upload: &UploadRecord,
        key: &str,
        requested: Vec<i32>,
    ) -> Result<PlannedTransfer, AccountError> {
        let multipart_id = match &upload.multipart_id {
            Some(id) => id.clone(),
            None => self.storage.multipart_id(key).await?,
        };
        let stored = self.storage.parts(key, &multipart_id).await?;
        validate_parts(&stored, upload.size_bytes)?;

        let mut plan = TransferPlan {
            confirmed_parts: stored.iter().map(|part| part.number).collect(),
            ..TransferPlan::default()
        };
        let signed_at = Utc::now();
        for number in requested {
            if plan.confirmed_parts.contains(&number) {
                continue;
            }
            let signature = UploadSignature {
                key,
                size_bytes: part_size(upload.size_bytes, number),
                multipart: Some(MultipartPart {
                    upload_id: &multipart_id,
                    number,
                }),
                issued_at: signed_at,
            };
            plan.requests.push(self.storage.sign(signature).await?);
        }

        Ok(PlannedTransfer {
            plan,
            multipart_id: Some(multipart_id),
            signed_at,
        })
    }

    async fn record_transfer(
        &self,
        actor: &Actor,
        claim: &TransferClaim,
        transfer: &PlannedTransfer,
    ) -> Result<(), AccountError> {
        let accounts = &self.reservations.accounts;
        let mut transaction = accounts.pool.begin().await?;
        lock_actor(&mut transaction, actor, &accounts.settings).await?;
        let write_expiry = if transfer.plan.requests.is_empty() {
            None
        } else {
            Some(transfer.signed_at + chrono::Duration::seconds(WRITE_SECONDS))
        };

        // Record the latest write expiry before the browser can use the signature.
        let update = sqlx::query(
            "UPDATE media_uploads SET multipart_id = $3,
                 last_write_expires_at = greatest(last_write_expires_at, $4),
                 expires_at = now() + ($5::bigint * interval '1 second'),
                 claim_id = NULL, claim_until = NULL
             WHERE id = $1 AND claim_id = $2 AND claim_until > now()
               AND state = 'reserved' AND expires_at > now()",
        )
        .bind(claim.upload.id)
        .bind(claim.token);
        let update =
            update.bind(&transfer.multipart_id).bind(write_expiry).bind(RESERVATION_SECONDS);
        if update.execute(&mut *transaction).await?.rows_affected() == 0 {
            return Err(AccountError::Conflict);
        }
        transaction.commit().await?;

        Ok(())
    }

    async fn verify_complete(&self, upload: &UploadRecord) -> Result<(), AccountError> {
        self.storage.provision().await?;
        let key = staging_key(upload.id);
        if self.has_complete_object(upload, &key).await? {
            return Ok(());
        }

        let upload_id = upload.multipart_id.as_deref();
        let upload_id = upload_id.ok_or(AccountError::Validation("upload is incomplete"))?;
        let parts = self.storage.parts(&key, upload_id).await?;
        validate_parts(&parts, upload.size_bytes)?;
        if parts.len() != part_count(upload.size_bytes) as usize {
            return Err(AccountError::Validation("upload is incomplete"));
        }

        // HEAD resolves an ambiguous completion before a retry can allocate another transfer.
        let completion = self.storage.complete(&key, upload_id, parts).await;
        if self.has_complete_object(upload, &key).await? {
            return Ok(());
        }
        completion?;

        Err(AccountError::Unavailable)
    }

    async fn queue_preparation(
        &self,
        actor: &Actor,
        claim: TransferClaim,
    ) -> Result<UploadStatus, AccountError> {
        let accounts = &self.reservations.accounts;
        let mut transaction = accounts.pool.begin().await?;
        lock_actor(&mut transaction, actor, &accounts.settings).await?;
        let upload = sqlx::query_as::<_, UploadRecord>(
            "UPDATE media_uploads SET state = 'uploaded', claim_id = NULL, claim_until = NULL
             WHERE id = $1 AND claim_id = $2 AND claim_until > now()
               AND state = 'reserved' AND expires_at > now()
             RETURNING *, false AS is_expired",
        )
        .bind(claim.upload.id)
        .bind(claim.token);
        let upload = upload.fetch_optional(&mut *transaction).await?;
        let upload = upload.ok_or(AccountError::Conflict)?;

        let job = sqlx::query("INSERT INTO media_preparation_jobs (upload_id) VALUES ($1)");
        job.bind(upload.id).execute(&mut *transaction).await?;
        transaction.commit().await?;

        Ok(upload.status())
    }
}
