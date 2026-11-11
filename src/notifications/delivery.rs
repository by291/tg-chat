//! Bounded fanout and leased delivery with an authorization check at dispatch time.

use std::{collections::HashMap, pin::Pin, sync::Arc, time::Duration};

use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgConnection, PgPool};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{accounts::AccountError, realtime::Activity};

use super::{NotificationIdentity, PushPayload, provider::ProviderTransport};

const FANOUT_BATCH_SIZE: i64 = 100;
const CLEANUP_BATCH_SIZE: i64 = 100;
const MAX_ATTEMPTS: i32 = 5;
const LEASE_SECONDS: i64 = 30;
const RETRY_SECONDS: i64 = 10;
const EXHAUSTED_RETENTION_DAYS: i64 = 7;
const POLL_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum PushOutcome {
    Sent,
    Retry,
    Rejected,
    EndpointGone,
    Expired,
}

pub struct PushAttempt<'a> {
    pub payload: &'a PushPayload,
    pub endpoint: &'a str,
    pub p256dh: &'a [u8],
    pub auth: &'a [u8],
    pub ttl: Duration,
}

pub trait PushTransport: Send + Sync {
    /// Deliver a bounded Push request through the configured provider.
    fn send<'a>(
        &'a self,
        attempt: PushAttempt<'a>,
    ) -> Pin<Box<dyn Future<Output = PushOutcome> + Send + 'a>>;
}

pub struct PushWorkerSettings {
    pub pool: PgPool,
    pub activity: Option<Activity>,
    pub idle_days: i64,
    pub transport: Option<Arc<dyn PushTransport>>,
}

pub struct PushRuntime<'a> {
    pub pool: PgPool,
    pub activity: Option<Activity>,
    pub idle_days: i64,
    pub values: &'a HashMap<String, String>,
}

pub struct PushWorker {
    pool: PgPool,
    activity: Option<Activity>,
    idle_days: i64,
    transport: Option<Arc<dyn PushTransport>>,
}

#[derive(FromRow)]
struct Intent {
    message_id: Uuid,
    recipient_ids: Vec<Uuid>,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    last_subscription_id: Option<Uuid>,
}

#[derive(FromRow)]
pub struct PushClaim {
    id: Uuid,
    lease_id: Uuid,
}

#[derive(FromRow)]
struct Dispatch {
    message_id: Uuid,
    conversation_id: Uuid,
    deployment_id: Uuid,
    subscription_id: Uuid,
    endpoint: String,
    p256dh: Vec<u8>,
    auth: Vec<u8>,
    ttl: i64,
}

enum Completion {
    Sent,
    Suppressed,
    Retry,
    Exhausted,
}

async fn subscriptions(
    connection: &mut PgConnection,
    intent: &Intent,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let select = sqlx::query_scalar(
        "SELECT subscription.id FROM push_subscriptions subscription
         JOIN sessions session ON session.id = subscription.session_id
         WHERE session.user_id = ANY($1) AND session.revoked_at IS NULL
           AND ($2::uuid IS NULL OR subscription.id > $2) AND subscription.created_at <= $3
         ORDER BY subscription.id LIMIT $4",
    );
    let select = select.bind(&intent.recipient_ids).bind(intent.last_subscription_id);
    let select = select.bind(intent.created_at).bind(FANOUT_BATCH_SIZE);
    select.fetch_all(connection).await
}

async fn finish(
    pool: &PgPool,
    claim: &PushClaim,
    completion: Completion,
) -> Result<(), sqlx::Error> {
    let status = match completion {
        Completion::Sent => "sent",
        Completion::Suppressed => "suppressed",
        Completion::Retry => "pending",
        Completion::Exhausted => "exhausted",
    };
    let update = sqlx::query(
        "UPDATE push_deliveries SET
             status = CASE WHEN $3 = 'pending' AND attempts >= $4 THEN 'exhausted' ELSE $3 END,
             lease_id = NULL, lease_until = NULL,
             available_at = clock_timestamp() + $5::bigint * interval '1 second',
             finished_at = CASE WHEN $3 <> 'pending' OR attempts >= $4 THEN clock_timestamp() END
         WHERE id = $1 AND lease_id = $2",
    );
    let update = update.bind(claim.id).bind(claim.lease_id).bind(status);
    let update = update.bind(MAX_ATTEMPTS).bind(RETRY_SECONDS);
    update.execute(pool).await?;

    Ok(())
}

async fn retire_endpoint(pool: &PgPool, claim: &PushClaim) -> Result<(), sqlx::Error> {
    let delete = sqlx::query(
        "DELETE FROM push_subscriptions WHERE id = (
             SELECT subscription_id FROM push_deliveries WHERE id = $1 AND lease_id = $2
         )",
    );
    delete.bind(claim.id).bind(claim.lease_id).execute(pool).await?;

    Ok(())
}

impl PushWorker {
    /// Configure Worker-only VAPID credentials and the delivery loop.
    pub fn from_values(runtime: PushRuntime<'_>) -> Self {
        let transport = ProviderTransport::from_values(runtime.values);
        let transport = transport.map(|transport| Arc::new(transport) as Arc<dyn PushTransport>);
        Self::new(PushWorkerSettings {
            pool: runtime.pool,
            activity: runtime.activity,
            idle_days: runtime.idle_days,
            transport,
        })
    }

    /// Attach a transport and an optional session-scoped foreground observer.
    pub fn new(settings: PushWorkerSettings) -> Self {
        Self {
            pool: settings.pool,
            activity: settings.activity,
            idle_days: settings.idle_days,
            transport: settings.transport,
        }
    }

    /// Create at most one bounded batch of delivery rows from a committed message.
    pub async fn fanout_next(&self) -> Result<bool, AccountError> {
        let mut transaction = self.pool.begin().await?;
        let select = sqlx::query_as(
            "SELECT message_id, recipient_ids, created_at, expires_at, last_subscription_id
             FROM push_intents WHERE fanned_at IS NULL AND expires_at > clock_timestamp()
             ORDER BY created_at, message_id LIMIT 1 FOR UPDATE SKIP LOCKED",
        );
        let Some(intent) = select.fetch_optional(&mut *transaction).await? else {
            return Ok(false);
        };
        let subscription_ids = subscriptions(&mut transaction, &intent).await?;
        let insert = sqlx::query(
            "INSERT INTO push_deliveries (message_id, subscription_id, expires_at)
             SELECT $1, id, $3 FROM unnest($2::uuid[]) AS subscription(id)
             ON CONFLICT (message_id, subscription_id) DO NOTHING",
        );
        let insert = insert.bind(intent.message_id).bind(&subscription_ids);
        let insert = insert.bind(intent.expires_at);
        insert.execute(&mut *transaction).await?;

        let last_id = subscription_ids.last().copied();
        let is_finished = (subscription_ids.len() as i64) < FANOUT_BATCH_SIZE;
        let advance = sqlx::query(
            "UPDATE push_intents SET last_subscription_id = $2,
                 fanned_at = CASE WHEN $3 THEN clock_timestamp() END WHERE message_id = $1",
        );
        let advance = advance.bind(intent.message_id).bind(last_id).bind(is_finished);
        advance.execute(&mut *transaction).await?;
        transaction.commit().await?;

        Ok(true)
    }

    /// Lease the next due delivery with a fresh completion fence.
    pub async fn claim(&self) -> Result<Option<PushClaim>, AccountError> {
        let claim = sqlx::query_as(
            "UPDATE push_deliveries SET status = 'running', attempts = attempts + 1,
                 lease_id = gen_random_uuid(),
                 lease_until = clock_timestamp() + $1::bigint * interval '1 second'
             WHERE id = (
                 SELECT id FROM push_deliveries WHERE status IN ('pending', 'running')
                   AND available_at <= clock_timestamp() AND expires_at > clock_timestamp()
                   AND (lease_until IS NULL OR lease_until <= clock_timestamp())
                   AND attempts < $2
                 ORDER BY available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
             ) RETURNING id, lease_id",
        );
        let claim = claim.bind(LEASE_SECONDS).bind(MAX_ATTEMPTS);

        Ok(claim.fetch_optional(&self.pool).await?)
    }

    async fn is_foreground(&self, claim: &PushClaim) -> Result<bool, sqlx::Error> {
        let Some(activity) = &self.activity else {
            return Ok(false);
        };
        let session = sqlx::query_scalar(
            "SELECT subscription.session_id FROM push_deliveries delivery
             JOIN push_subscriptions subscription ON subscription.id = delivery.subscription_id
             WHERE delivery.id = $1 AND delivery.lease_id = $2",
        );
        let session = session.bind(claim.id).bind(claim.lease_id);
        let Some(session_id) = session.fetch_optional(&self.pool).await? else {
            return Ok(false);
        };

        Ok(activity.is_foreground(session_id).await)
    }

    async fn eligible(&self, claim: &PushClaim) -> Result<Option<Dispatch>, sqlx::Error> {
        let select = sqlx::query_as(
            "SELECT message.id AS message_id, message.conversation_id,
                    deployment.id AS deployment_id, subscription.id AS subscription_id,
                    subscription.endpoint, subscription.p256dh, subscription.auth,
                    floor(extract(epoch FROM least(
                        delivery.expires_at, message.expires_at, subscription.expires_at,
                        session.expires_at, session.last_seen_at + $3::bigint * interval '1 day'
                    ) - clock_timestamp()))::bigint AS ttl
             FROM push_deliveries delivery
             JOIN messages message ON message.id = delivery.message_id
             JOIN conversations conversation ON conversation.id = message.conversation_id
             JOIN push_subscriptions subscription ON subscription.id = delivery.subscription_id
             JOIN sessions session ON session.id = subscription.session_id
             JOIN users account ON account.id = session.user_id
             JOIN conversation_members member ON member.user_id = account.id
                AND member.conversation_id = conversation.id
             CROSS JOIN deployment_identity deployment
             LEFT JOIN account_preferences preferences ON preferences.user_id = account.id
             WHERE delivery.id = $1 AND delivery.lease_id = $2
               AND delivery.lease_until > clock_timestamp()
               AND delivery.expires_at > clock_timestamp()
               AND conversation.deleted_at IS NULL AND NOT conversation.is_quarantined
               AND conversation.kind <> 'saved' AND message.service_kind IS NULL
               AND message.deleted_at IS NULL
               AND (message.expires_at IS NULL OR message.expires_at > clock_timestamp())
               AND account.id <> message.author_id AND NOT account.is_suspended
               AND session.revoked_at IS NULL AND session.expires_at > clock_timestamp()
               AND session.last_seen_at > clock_timestamp() - $3::bigint * interval '1 day'
               AND (subscription.expires_at IS NULL OR subscription.expires_at > clock_timestamp())
               AND member.directory_active AND NOT member.is_banned
               AND (member.muted_until IS NULL OR member.muted_until <= clock_timestamp())
               AND message.sequence > greatest(member.read_through, member.clear_through)
               AND NOT EXISTS (
                   SELECT 1 FROM hidden_messages hidden
                   WHERE hidden.user_id = account.id AND hidden.message_id = message.id
               )
               AND NOT EXISTS (
                   SELECT 1 FROM blocks WHERE (owner_id, target_id) IN (
                       (account.id, message.author_id), (message.author_id, account.id)
                   )
               )
               AND coalesce((
                   preferences.notification_defaults->>'should_show_notifications'
               )::bool, true)
               AND coalesce((
                   preferences.notification_defaults->>'should_show_offline_notifications'
               )::bool, true)
               AND coalesce((preferences.notification_defaults #>> ARRAY[
                   CASE WHEN conversation.kind = 'direct' THEN 'private' ELSE conversation.kind END,
                   'should_notify'
               ])::bool, true)",
        );
        let select = select.bind(claim.id).bind(claim.lease_id).bind(self.idle_days);
        select.fetch_optional(&self.pool).await
    }

    /// Recheck policy for the leased session immediately before contacting its provider.
    pub async fn dispatch(&self, claim: PushClaim) -> Result<(), AccountError> {
        let Some(transport) = &self.transport else {
            return Ok(());
        };
        if self.is_foreground(&claim).await? {
            finish(&self.pool, &claim, Completion::Suppressed).await?;
            return Ok(());
        }
        let Some(dispatch) = self.eligible(&claim).await? else {
            finish(&self.pool, &claim, Completion::Suppressed).await?;
            return Ok(());
        };
        if dispatch.ttl <= 0 {
            finish(&self.pool, &claim, Completion::Suppressed).await?;
            return Ok(());
        }
        let payload = PushPayload {
            identity: NotificationIdentity {
                deployment_id: dispatch.deployment_id,
                message_id: dispatch.message_id,
                subscription_id: dispatch.subscription_id,
            },
            conversation_id: dispatch.conversation_id,
        };
        let attempt = PushAttempt {
            payload: &payload,
            endpoint: &dispatch.endpoint,
            p256dh: &dispatch.p256dh,
            auth: &dispatch.auth,
            ttl: Duration::from_secs(dispatch.ttl as u64),
        };
        let completion = match transport.send(attempt).await {
            PushOutcome::Sent => Completion::Sent,
            PushOutcome::Retry => Completion::Retry,
            PushOutcome::Rejected => Completion::Exhausted,
            PushOutcome::Expired => Completion::Suppressed,
            PushOutcome::EndpointGone => {
                retire_endpoint(&self.pool, &claim).await?;
                Completion::Suppressed
            }
        };
        finish(&self.pool, &claim, completion).await?;

        Ok(())
    }

    async fn prune(&self) -> Result<(), sqlx::Error> {
        let subscriptions = sqlx::query(
            "DELETE FROM push_subscriptions WHERE id IN (
                 SELECT subscription.id FROM push_subscriptions subscription
                 JOIN sessions session ON session.id = subscription.session_id
                 JOIN users account ON account.id = session.user_id
                 WHERE session.revoked_at IS NOT NULL OR session.expires_at <= clock_timestamp()
                   OR session.last_seen_at <= clock_timestamp() - $2::bigint * interval '1 day'
                   OR account.is_suspended OR subscription.expires_at <= clock_timestamp()
                 ORDER BY subscription.id LIMIT $1 FOR UPDATE OF subscription SKIP LOCKED
             )",
        );
        subscriptions.bind(CLEANUP_BATCH_SIZE).bind(self.idle_days).execute(&self.pool).await?;
        let intents = sqlx::query(
            "DELETE FROM push_intents WHERE message_id IN (
                 SELECT message_id FROM push_intents WHERE expires_at <= clock_timestamp()
                 ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED
             )",
        );
        intents.bind(CLEANUP_BATCH_SIZE).execute(&self.pool).await?;
        let deliveries = sqlx::query(
            "DELETE FROM push_deliveries WHERE id IN (
                 SELECT id FROM push_deliveries WHERE expires_at <= clock_timestamp()
                   AND (status <> 'exhausted' OR
                        expires_at <= clock_timestamp() - $2::bigint * interval '1 day')
                 ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED
             )",
        );
        deliveries
            .bind(CLEANUP_BATCH_SIZE)
            .bind(EXHAUSTED_RETENTION_DAYS)
            .execute(&self.pool)
            .await?;
        let exhaust = sqlx::query(
            "UPDATE push_deliveries SET status = 'exhausted', finished_at = clock_timestamp(),
                 lease_id = NULL, lease_until = NULL
             WHERE id IN (
                 SELECT id FROM push_deliveries WHERE status = 'running'
                   AND lease_until <= clock_timestamp() AND attempts >= $1
                 ORDER BY lease_until LIMIT $2 FOR UPDATE SKIP LOCKED
             )",
        );
        exhaust.bind(MAX_ATTEMPTS).bind(CLEANUP_BATCH_SIZE).execute(&self.pool).await?;

        Ok(())
    }

    /// Service the queue without making Push a dependency of message delivery.
    pub async fn run(&self, stop: CancellationToken) {
        let mut next_cleanup = Instant::now();
        loop {
            if Instant::now() >= next_cleanup {
                let cleanup = tokio::select! {
                    () = stop.cancelled() => break,
                    result = self.prune() => result,
                };
                if cleanup.is_err() {
                    tracing::warn!("push_cleanup_unavailable");
                }
                next_cleanup = Instant::now() + POLL_INTERVAL;
            }
            let result = tokio::select! {
                () = stop.cancelled() => break,
                result = self.process_next() => result,
            };
            match result {
                Ok(true) => continue,
                Ok(false) => {}
                Err(_) => tracing::warn!("push_delivery_unavailable"),
            }
            tokio::select! {
                () = stop.cancelled() => break,
                () = tokio::time::sleep(POLL_INTERVAL) => {}
            }
        }
    }

    /// Process a bounded fanout and delivery unit.
    pub async fn process_next(&self) -> Result<bool, AccountError> {
        if self.transport.is_none() {
            return Ok(false);
        }
        let has_fanned_out = self.fanout_next().await?;
        let Some(claim) = self.claim().await? else {
            return Ok(has_fanned_out);
        };
        self.dispatch(claim).await?;

        Ok(true)
    }
}

/// Requeue a still-live exhausted delivery with the same notification identity.
pub(crate) async fn retry_exhausted(
    connection: &mut PgConnection,
    id: Uuid,
) -> Result<bool, sqlx::Error> {
    let update = sqlx::query(
        "UPDATE push_deliveries SET status = 'pending', attempts = 0,
             available_at = clock_timestamp(), finished_at = NULL
         WHERE id = $1 AND status = 'exhausted' AND expires_at > clock_timestamp()
           AND EXISTS (SELECT 1 FROM push_subscriptions WHERE id = push_deliveries.subscription_id)",
    );
    let updated = update.bind(id).execute(connection).await?.rows_affected();

    Ok(updated == 1)
}
