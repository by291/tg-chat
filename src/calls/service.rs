use std::{collections::HashMap, num::NonZeroU32};

use chrono::{DateTime, TimeDelta, Utc};
use serde_json::{Value, json};
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

use super::{
    model::{
        CallAction, CallCommand, CallEndReason, CallPhase, CallRow, CallView, CallViewer, StartCall,
    },
    termination::{FinishCall, TerminationCheck, finish_call, is_access_invalidated},
};
use crate::{
    accounts::{AccountError, AccountService, Actor, sessions::lock_actor},
    conversations::access::{self, LockedConversation},
    realtime::RealtimeClient,
};

const DEFAULT_CAPACITY: NonZeroU32 = NonZeroU32::new(10).unwrap();
const STARTS_PER_MINUTE: i64 = 5;
const MAX_OPERATION_RECEIPTS: i64 = 2_000;
const RECEIPT_RETENTION_DAYS: i64 = 7;
const RINGING_DURATION: TimeDelta = TimeDelta::seconds(30);
const SETUP_DURATION: TimeDelta = TimeDelta::seconds(30);

#[derive(Clone)]
pub struct CallService {
    accounts: AccountService,
    capacity: NonZeroU32,
    realtime: Option<RealtimeClient>,
}

pub(crate) struct LockCall<'a> {
    pub call_id: Uuid,
    pub actor: Option<&'a Actor>,
}

#[derive(FromRow)]
struct OperationReceipt {
    call_id: Uuid,
    session_id: Uuid,
    request: Value,
}

struct SaveReceipt<'a> {
    actor: &'a Actor,
    operation_id: Uuid,
    call_id: Uuid,
    request: Value,
}

struct Admission<'a> {
    actor: &'a Actor,
    input: StartCall,
    recipient_id: Uuid,
}

struct CommandAt<'a> {
    actor: &'a Actor,
    input: CallCommand,
    now: DateTime<Utc>,
}

#[derive(FromRow)]
struct CallPolicy {
    is_eligible: bool,
    is_audience_allowed: bool,
}

impl CallService {
    /// Create the database-backed call service with default deployment admission.
    pub fn new(accounts: AccountService) -> Self {
        Self {
            accounts,
            capacity: DEFAULT_CAPACITY,
            realtime: None,
        }
    }

    /// Apply the deployment-wide maximum for simultaneously admitted calls.
    pub fn with_capacity(mut self, capacity: NonZeroU32) -> Self {
        self.capacity = capacity;

        self
    }

    /// Attach the personal realtime publisher used after a committed call revision.
    pub fn with_realtime(mut self, realtime: Option<RealtimeClient>) -> Self {
        self.realtime = realtime;

        self
    }

    /// Return the minimal outcome only to a session that owned this call.
    pub(crate) async fn outcome(
        &self,
        actor: &Actor,
        call_id: Uuid,
    ) -> Result<Option<CallEndReason>, AccountError> {
        let mut transaction = self.accounts.pool.begin().await?;
        self.authorize_actor(&mut transaction, actor).await?;

        // A policy change can end the call and hide its peer. Return only the outcome here.
        let query = sqlx::query_scalar(
            "SELECT end_reason FROM calls WHERE id = $1 AND (
                (caller_id = $2 AND caller_session_id = $3)
                OR (recipient_id = $2 AND accepting_session_id = $3)
             )",
        );
        let query = query.bind(call_id).bind(actor.user_id).bind(actor.session_id);
        let outcome = query.fetch_optional(&mut *transaction).await?;

        outcome.ok_or(AccountError::NotFound)
    }

    /// Read deployment call capacity independently of the optional media provider.
    pub fn capacity_from_values(
        values: &HashMap<String, String>,
    ) -> Result<NonZeroU32, AccountError> {
        let Some(configured) = values.get("TG_CHAT_CALL_CAPACITY") else {
            return Ok(DEFAULT_CAPACITY);
        };

        configured.parse().map_err(|_| {
            AccountError::Validation("TG_CHAT_CALL_CAPACITY must be a positive integer")
        })
    }

    /// Start or replay a call for an existing direct conversation.
    pub async fn start(&self, actor: &Actor, input: StartCall) -> Result<CallView, AccountError> {
        let mut transaction = self.accounts.pool.begin().await?;
        let conversation =
            lock_direct_conversation(&mut transaction, actor, input.conversation_id).await?;
        let recipient_id = direct_peer(&conversation, actor)?;
        lock_accounts(&mut transaction, &conversation).await?;
        let request = json!({
            "kind": "start",
            "conversation_id": input.conversation_id,
            "mode": input.mode,
        });

        let existing = receipt(&mut transaction, actor, input.operation_id).await?;
        if let Some(existing) = existing {
            existing.validate(actor, &request)?;
            let call = lock_call_row(
                &mut transaction,
                LockCall {
                    call_id: existing.call_id,
                    actor: Some(actor),
                },
            )
            .await?;
            self.authorize_actor(&mut transaction, actor).await?;
            self.authorize_call(&mut transaction, &call).await?;

            return view(&mut transaction, actor, &call).await;
        }

        self.authorize_actor(&mut transaction, actor).await?;
        require_open_chat(&mut transaction, actor, input.conversation_id).await?;
        let policy = policy(&mut transaction, actor.user_id, recipient_id).await?;
        if !policy.is_eligible || !policy.is_audience_allowed {
            return Err(AccountError::CallNotAllowed);
        }

        ensure_receipt_capacity(&mut transaction, actor).await?;
        let call = self
            .admit(
                &mut transaction,
                Admission {
                    actor,
                    input,
                    recipient_id,
                },
            )
            .await?;
        save_receipt(
            &mut transaction,
            SaveReceipt {
                actor,
                operation_id: input.operation_id,
                call_id: call.id,
                request,
            },
        )
        .await?;
        let result = view(&mut transaction, actor, &call).await?;
        transaction.commit().await?;
        publish_hint(self.realtime.as_ref(), &call).await;

        Ok(result)
    }

    /// Apply a session-authorized transition or return the current view of a stale command.
    pub async fn command(
        &self,
        actor: &Actor,
        input: CallCommand,
    ) -> Result<CallView, AccountError> {
        let mut transaction = self.accounts.pool.begin().await?;
        let call = lock_call(
            &mut transaction,
            LockCall {
                call_id: input.call_id,
                actor: Some(actor),
            },
        )
        .await?;
        self.authorize_actor(&mut transaction, actor).await?;
        self.authorize_call(&mut transaction, &call).await?;

        let request = json!({
            "kind": "command",
            "call_id": input.call_id,
            "action": input.action,
        });
        if let Some(existing) = receipt(&mut transaction, actor, input.operation_id).await? {
            existing.validate(actor, &request)?;

            return view(&mut transaction, actor, &call).await;
        }

        ensure_receipt_capacity(&mut transaction, actor).await?;

        // Lock waits can outlast a ringing or setup deadline even within one transaction.
        let now = database_now(&mut transaction).await?;
        let original_revision = call.revision;
        let call = apply_command(
            &mut transaction,
            call,
            CommandAt {
                actor,
                input,
                now,
            },
        )
        .await?;
        save_receipt(
            &mut transaction,
            SaveReceipt {
                actor,
                operation_id: input.operation_id,
                call_id: call.id,
                request,
            },
        )
        .await?;
        let result = view(&mut transaction, actor, &call).await?;
        transaction.commit().await?;
        if call.revision != original_revision {
            publish_hint(self.realtime.as_ref(), &call).await;
        }

        Ok(result)
    }

    /// Return the visible ringing or designated live call for the authenticated session.
    pub async fn current(&self, actor: &Actor) -> Result<Option<CallView>, AccountError> {
        let mut transaction = self.accounts.pool.begin().await?;
        let candidate = sqlx::query_scalar("SELECT call_id FROM call_slots WHERE user_id = $1");
        let call_id = candidate.bind(actor.user_id).fetch_optional(&mut *transaction).await?;
        let Some(call_id) = call_id else {
            self.authorize_actor(&mut transaction, actor).await?;

            return Ok(None);
        };

        let call = lock_call(
            &mut transaction,
            LockCall {
                call_id,
                actor: Some(actor),
            },
        )
        .await?;
        self.authorize_actor(&mut transaction, actor).await?;
        match self.authorize_call(&mut transaction, &call).await {
            Ok(()) => {}
            Err(AccountError::CallNotAllowed) => return Ok(None),
            Err(error) => return Err(error),
        }

        let can_ring = call.phase == CallPhase::Ringing && actor.user_id == call.recipient_id;
        let is_visible = call.phase != CallPhase::Ended && (can_ring || call.is_designated(actor));
        if !is_visible {
            return Ok(None);
        }

        let snapshot = view(&mut transaction, actor, &call).await?;
        if snapshot.allowed_actions.is_empty() {
            return Ok(None);
        }

        Ok(Some(snapshot))
    }

    /// Recheck the request session at the database lock boundary.
    pub(crate) async fn authorize_actor(
        &self,
        connection: &mut PgConnection,
        actor: &Actor,
    ) -> Result<(), AccountError> {
        lock_actor(connection, actor, &self.accounts.settings).await?;

        Ok(())
    }

    /// Recheck call policy and designated session eligibility while their rows remain locked.
    pub(crate) async fn authorize_call(
        &self,
        connection: &mut PgConnection,
        call: &CallRow,
    ) -> Result<(), AccountError> {
        require_live_conversation(connection, call.conversation_id).await?;
        let policy = policy(connection, call.caller_id, call.recipient_id).await?;
        let is_ringing_allowed = call.phase != CallPhase::Ringing || policy.is_audience_allowed;
        if !policy.is_eligible || !is_ringing_allowed {
            return Err(AccountError::CallNotAllowed);
        }

        if call.phase == CallPhase::Ended {
            return Ok(());
        }

        let check = TerminationCheck {
            call,
            idle_days: self.accounts.settings.idle_days,
        };
        if is_access_invalidated(connection, check).await? {
            return Err(AccountError::CallNotAllowed);
        }

        Ok(())
    }

    async fn admit(
        &self,
        connection: &mut PgConnection,
        admission: Admission<'_>,
    ) -> Result<CallRow, AccountError> {
        let user_ids = [admission.actor.user_id, admission.recipient_id];
        let occupied = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM call_slots WHERE user_id = ANY($1))",
        );
        if occupied.bind(user_ids).fetch_one(&mut *connection).await? {
            return Err(AccountError::CallBusy);
        }

        // Capacity admission follows account and session locks, and never gates commands.
        sqlx::query("SELECT singleton FROM call_admission WHERE singleton FOR UPDATE")
            .execute(&mut *connection)
            .await?;
        let count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM call_slots");
        let occupied_slots = count.fetch_one(&mut *connection).await?;
        if occupied_slots >= i64::from(self.capacity.get()) * 2 {
            return Err(AccountError::CallBusy);
        }

        self.authorize_actor(connection, admission.actor).await?;
        let starts = sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM calls WHERE caller_id = $1
             AND created_at > clock_timestamp() - interval '1 minute'",
        );
        let recent_starts =
            starts.bind(admission.actor.user_id).fetch_one(&mut *connection).await?;
        if recent_starts >= STARTS_PER_MINUTE {
            return Err(AccountError::RateLimited);
        }

        insert_call(connection, admission).await
    }
}

impl OperationReceipt {
    /// Ensure a committed operation is retried with its original session and payload.
    fn validate(&self, actor: &Actor, request: &Value) -> Result<(), AccountError> {
        if self.session_id != actor.session_id || self.request != *request {
            return Err(AccountError::OperationConflict);
        }

        Ok(())
    }
}

/// Lock a call from its immutable conversation identity before checking mutable state.
pub(crate) async fn lock_call(
    connection: &mut PgConnection,
    input: LockCall<'_>,
) -> Result<CallRow, AccountError> {
    let candidate = read_call(connection, input.call_id).await?;
    if input.actor.is_some_and(|actor| !candidate.has_participant(actor)) {
        return Err(AccountError::NotFound);
    }

    // The Worker also needs to lock a conversation that just lost policy eligibility.
    let query = sqlx::query_as::<_, LockedConversation>(
        "SELECT * FROM conversations WHERE id = $1 FOR UPDATE",
    );
    let conversation = query.bind(candidate.conversation_id).fetch_one(&mut *connection).await?;
    lock_accounts(connection, &conversation).await?;

    lock_call_row(connection, input).await
}

async fn lock_call_row(
    connection: &mut PgConnection,
    input: LockCall<'_>,
) -> Result<CallRow, AccountError> {
    // The conversation lock makes the designated session list stable before taking session locks.
    let call = read_call(connection, input.call_id).await?;
    let sessions = [
        Some(call.caller_session_id),
        call.accepting_session_id,
        input.actor.map(|actor| actor.session_id),
    ];
    let session_ids: Vec<_> = sessions.into_iter().flatten().collect();
    sqlx::query("SELECT id FROM sessions WHERE id = ANY($1) ORDER BY id FOR UPDATE")
        .bind(&session_ids)
        .execute(&mut *connection)
        .await?;

    let query = sqlx::query_as("SELECT * FROM calls WHERE id = $1 FOR UPDATE");
    Ok(query.bind(input.call_id).fetch_one(connection).await?)
}

async fn read_call(connection: &mut PgConnection, call_id: Uuid) -> Result<CallRow, AccountError> {
    let query = sqlx::query_as("SELECT * FROM calls WHERE id = $1");
    query.bind(call_id).fetch_optional(connection).await?.ok_or(AccountError::NotFound)
}

async fn lock_direct_conversation(
    connection: &mut PgConnection,
    actor: &Actor,
    conversation_id: Uuid,
) -> Result<LockedConversation, AccountError> {
    let conversations = access::lock_conversations(connection, actor, &[conversation_id]).await?;
    let Some(conversation) = conversations.into_iter().next() else {
        return Err(AccountError::CallNotAllowed);
    };
    if conversation.kind != "direct" {
        return Err(AccountError::CallNotAllowed);
    }

    Ok(conversation)
}

fn direct_peer(conversation: &LockedConversation, actor: &Actor) -> Result<Uuid, AccountError> {
    let peer_id = match (conversation.participant_low, conversation.participant_high) {
        (Some(low), Some(high)) if low == actor.user_id => Some(high),
        (Some(low), Some(high)) if high == actor.user_id => Some(low),
        _ => None,
    };

    peer_id.ok_or(AccountError::CallNotAllowed)
}

async fn lock_accounts(
    connection: &mut PgConnection,
    conversation: &LockedConversation,
) -> Result<(), AccountError> {
    access::lock_participants(connection, conversation).await.map_err(|error| error.into_public())
}

async fn require_open_chat(
    connection: &mut PgConnection,
    actor: &Actor,
    conversation_id: Uuid,
) -> Result<(), AccountError> {
    let query = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM conversation_members
         WHERE conversation_id = $1 AND user_id = $2 AND directory_active)",
    );
    let query = query.bind(conversation_id).bind(actor.user_id);
    if !query.fetch_one(connection).await? {
        return Err(AccountError::CallNotAllowed);
    }

    Ok(())
}

async fn require_live_conversation(
    connection: &mut PgConnection,
    conversation_id: Uuid,
) -> Result<(), AccountError> {
    let query = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM conversations WHERE id = $1
         AND kind = 'direct' AND deleted_at IS NULL AND NOT is_quarantined)",
    );
    if !query.bind(conversation_id).fetch_one(connection).await? {
        return Err(AccountError::CallNotAllowed);
    }

    Ok(())
}

async fn policy(
    connection: &mut PgConnection,
    caller_id: Uuid,
    recipient_id: Uuid,
) -> Result<CallPolicy, AccountError> {
    let query = sqlx::query_as(
        "SELECT NOT caller.is_suspended AND NOT recipient.is_suspended
            AND caller.deleted_at IS NULL AND recipient.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM blocks WHERE
                (owner_id = $1 AND target_id = $2) OR (owner_id = $2 AND target_id = $1))
            AS is_eligible,
            (recipient.call_audience = 'everyone' OR (recipient.call_audience = 'contacts'
                AND EXISTS (SELECT 1 FROM contacts WHERE owner_id = $2 AND target_id = $1)))
            AS is_audience_allowed
         FROM users caller CROSS JOIN users recipient WHERE caller.id = $1 AND recipient.id = $2",
    );
    let query = query.bind(caller_id).bind(recipient_id);

    Ok(query.fetch_one(connection).await?)
}

/// Read database wall-clock time after any relevant locks have been taken.
pub(crate) async fn database_now(
    connection: &mut PgConnection,
) -> Result<DateTime<Utc>, AccountError> {
    Ok(sqlx::query_scalar("SELECT clock_timestamp()").fetch_one(connection).await?)
}

async fn view(
    connection: &mut PgConnection,
    actor: &Actor,
    call: &CallRow,
) -> Result<CallView, AccountError> {
    let query = sqlx::query_scalar("SELECT display_name FROM users WHERE id = $1");
    let peer_display_name = query.bind(call.peer_id(actor)).fetch_one(&mut *connection).await?;
    let now = database_now(connection).await?;
    let is_room_ready = if call.is_designated(actor)
        && matches!(call.phase, CallPhase::Connecting | CallPhase::Active)
    {
        let query = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM call_rooms WHERE call_id = $1 AND provider_sid IS NOT NULL)",
        );
        query.bind(call.id).fetch_one(&mut *connection).await?
    } else {
        false
    };

    Ok(call.view(CallViewer {
        actor,
        peer_display_name,
        now,
        is_room_ready,
    }))
}

async fn insert_call(
    connection: &mut PgConnection,
    admission: Admission<'_>,
) -> Result<CallRow, AccountError> {
    let now = database_now(connection).await?;
    let insert = sqlx::query_as::<_, CallRow>(
        "INSERT INTO calls (
            id, conversation_id, caller_id, recipient_id, caller_session_id, mode,
            phase, created_at, ringing_deadline
         ) VALUES ($1, $2, $3, $4, $5, $6, 'ringing', $7, $8) RETURNING *",
    );
    let insert = insert.bind(Uuid::new_v4()).bind(admission.input.conversation_id);
    let insert = insert.bind(admission.actor.user_id).bind(admission.recipient_id);
    let insert = insert.bind(admission.actor.session_id).bind(admission.input.mode);
    let insert = insert.bind(now).bind(now + RINGING_DURATION);
    let call = insert.fetch_one(&mut *connection).await?;

    let slots = sqlx::query("INSERT INTO call_slots (user_id, call_id) VALUES ($1, $3), ($2, $3)");
    let slots = slots.bind(call.caller_id).bind(call.recipient_id);
    slots.bind(call.id).execute(connection).await?;

    Ok(call)
}

async fn apply_command(
    connection: &mut PgConnection,
    call: CallRow,
    command: CommandAt<'_>,
) -> Result<CallRow, AccountError> {
    if call.deadline().is_some_and(|deadline| deadline <= command.now) {
        let reason = match call.phase {
            CallPhase::Ringing => CallEndReason::Missed,
            _ => CallEndReason::TransportFailed,
        };

        let input = FinishCall {
            call_id: call.id,
            reason,
        };

        return Ok(finish_call(connection, input).await?.unwrap_or(call));
    }

    let allowed_actions = call.allowed_actions(command.actor, command.now);
    if !allowed_actions.contains(&command.input.action) {
        return Ok(call);
    }

    let reason = match command.input.action {
        CallAction::Accept => return accept_call(connection, &call, command).await,
        CallAction::Decline => CallEndReason::Declined,
        CallAction::Cancel => CallEndReason::Cancelled,
        CallAction::Hangup => CallEndReason::Completed,
        CallAction::MediaPermissionDenied => CallEndReason::PermissionDenied,
    };
    let input = FinishCall {
        call_id: call.id,
        reason,
    };

    Ok(finish_call(connection, input).await?.unwrap_or(call))
}

async fn accept_call(
    connection: &mut PgConnection,
    call: &CallRow,
    command: CommandAt<'_>,
) -> Result<CallRow, AccountError> {
    let query = sqlx::query_as(
        "UPDATE calls SET phase = 'connecting', accepting_session_id = $2,
            accepted_at = $3, setup_deadline = $4, revision = revision + 1
         WHERE id = $1 RETURNING *",
    );
    let query = query.bind(call.id).bind(command.actor.session_id);
    let query = query.bind(command.now).bind(command.now + SETUP_DURATION);

    Ok(query.fetch_one(connection).await?)
}

async fn receipt(
    connection: &mut PgConnection,
    actor: &Actor,
    operation_id: Uuid,
) -> Result<Option<OperationReceipt>, AccountError> {
    let query = sqlx::query_as(
        "SELECT call_id, session_id, request FROM call_operation_receipts
         WHERE user_id = $1 AND operation_id = $2",
    );
    let query = query.bind(actor.user_id).bind(operation_id);

    Ok(query.fetch_optional(connection).await?)
}

async fn ensure_receipt_capacity(
    connection: &mut PgConnection,
    actor: &Actor,
) -> Result<(), AccountError> {
    // Preserve all receipts for live calls while bounding completed operations per account.
    let prune = sqlx::query(
        "DELETE FROM call_operation_receipts receipt USING calls
         WHERE receipt.user_id = $1 AND receipt.call_id = calls.id AND calls.phase = 'ended'
         AND receipt.created_at < clock_timestamp() - ($2::bigint * interval '1 day')",
    );
    let prune = prune.bind(actor.user_id).bind(RECEIPT_RETENTION_DAYS);
    prune.execute(&mut *connection).await?;

    let count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM call_operation_receipts WHERE user_id = $1",
    );
    let receipt_count = count.bind(actor.user_id).fetch_one(connection).await?;
    if receipt_count >= MAX_OPERATION_RECEIPTS {
        return Err(AccountError::RateLimited);
    }

    Ok(())
}

async fn save_receipt(
    connection: &mut PgConnection,
    receipt: SaveReceipt<'_>,
) -> Result<(), AccountError> {
    let query = sqlx::query(
        "INSERT INTO call_operation_receipts (user_id, operation_id, session_id, call_id, request)
         VALUES ($1, $2, $3, $4, $5)",
    );
    let query = query.bind(receipt.actor.user_id).bind(receipt.operation_id);
    let query = query.bind(receipt.actor.session_id).bind(receipt.call_id);
    query.bind(receipt.request).execute(connection).await?;

    Ok(())
}

/// Wake both participants after commit without requiring realtime delivery for correctness.
pub(crate) async fn publish_hint(client: Option<&RealtimeClient>, call: &CallRow) {
    let Some(client) = client else {
        return;
    };
    let _ = tokio::join!(
        client.publish_call_hint(call.caller_id),
        client.publish_call_hint(call.recipient_id),
    );
}
