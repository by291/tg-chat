use std::time::Duration;

use lettre::{AsyncTransport, Message, message::header::ContentType};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

use super::{DeliveryOutcome, MailClaim, MailQueue};
use crate::features::accounts::AccountError;

const DELIVERY_TIMEOUT: Duration = Duration::from_secs(25);
const IDLE_POLL_INTERVAL: Duration = Duration::from_secs(1);

impl MailQueue {
    /// Deliver outside business transactions, then fence completion against the current lease.
    pub async fn deliver(&self, claim: &MailClaim) -> Result<(), AccountError> {
        let prepared = self.prepare(claim).await;
        let outgoing = match prepared {
            Ok(Some(outgoing)) => outgoing,
            Ok(None) => {
                self.finish(claim, DeliveryOutcome::Discarded).await?;
                return Ok(());
            }
            Err(error) => {
                self.finish(claim, DeliveryOutcome::Retry).await?;
                return Err(error);
            }
        };
        let sender = self.sender.clone().ok_or(AccountError::EmailUnavailable)?;
        let transport = self.transport.as_ref().ok_or(AccountError::EmailUnavailable)?;
        let recipient = outgoing.recipient.parse().map_err(|_| AccountError::Unavailable)?;
        let message = Message::builder().from(sender).to(recipient);
        let message = message.subject(outgoing.subject).header(ContentType::TEXT_PLAIN);
        let message = message.body(outgoing.body).map_err(|_| AccountError::Unavailable)?;
        let outcome = timeout(DELIVERY_TIMEOUT, transport.send(message)).await;
        let was_sent = matches!(outcome, Ok(Ok(_)));
        let completion = if was_sent {
            DeliveryOutcome::Sent
        } else {
            DeliveryOutcome::Retry
        };
        self.finish(claim, completion).await?;
        if !was_sent {
            return Err(AccountError::Unavailable);
        }

        Ok(())
    }

    /// Stop taking new jobs on shutdown while bounding the single active SMTP delivery.
    pub async fn run(&self, shutdown: CancellationToken) {
        if !self.is_enabled() {
            tracing::info!("mail_delivery_disabled");
            return;
        }
        loop {
            if shutdown.is_cancelled() {
                return;
            }
            let claim = self.claim().await;
            match claim {
                Ok(Some(claim)) => {
                    if self.deliver(&claim).await.is_err() {
                        // SMTP diagnostics may contain recipients or links; log only the job ID.
                        tracing::warn!(job_id = %claim.id, "mail_delivery_retry");
                    }
                }
                Ok(None) => {}
                Err(_) => tracing::warn!("mail_queue_unavailable"),
            }
            tokio::select! {
                _ = shutdown.cancelled() => return,
                _ = tokio::time::sleep(IDLE_POLL_INTERVAL) => {}
            }
        }
    }
}
