//! Room credentials and application signaling admission.

use sqlx::{FromRow, PgConnection, PgPool};
use uuid::Uuid;

use crate::accounts::{AccountError, Actor};

use super::{
    livekit::{LiveKit, ProviderIdentity, RoomCredentials},
    model::{CallPhase, CallRow},
    service::{CallService, LockCall, database_now, lock_call},
};

#[derive(Clone)]
pub(crate) struct CallRooms {
    pool: PgPool,
    calls: CallService,
    provider: LiveKit,
}

#[derive(FromRow)]
struct CallRoom {
    room_name: String,
    caller_identity: Uuid,
    recipient_identity: Uuid,
    provider_sid: Option<String>,
}

impl CallRooms {
    /// Share the call policy and provider between credential and signaling admission.
    pub(crate) fn new(pool: PgPool, calls: CallService, provider: LiveKit) -> Self {
        Self {
            pool,
            calls,
            provider,
        }
    }

    /// Mint media access only after checking current designation and room readiness.
    pub(crate) async fn credentials(
        &self,
        actor: &Actor,
        call_id: Uuid,
    ) -> Result<RoomCredentials, AccountError> {
        let mut transaction = self.pool.begin().await?;
        let call = lock_call(
            &mut transaction,
            LockCall {
                call_id,
                actor: Some(actor),
            },
        )
        .await?;
        self.calls.authorize_actor(&mut transaction, actor).await?;
        if !call.is_designated(actor) {
            return Err(AccountError::Forbidden);
        }
        self.require_media_access(&mut transaction, &call).await?;
        let room = ready_room(&mut transaction, call.id).await?;

        let participant = if actor.user_id == call.caller_id {
            room.caller_identity
        } else {
            room.recipient_identity
        };
        let credentials = self.provider.issue(&room.room_name, participant)?;
        transaction.commit().await?;

        Ok(credentials)
    }

    /// Recheck application state for every new provider signaling connection.
    pub(crate) async fn authorize_signaling(&self, token: &str) -> Result<(), AccountError> {
        let identity = self.provider.verify_identity(token)?;
        let mut transaction = self.pool.begin().await?;
        let call_id = find_call(&mut transaction, &identity).await?;
        let call = lock_call(
            &mut transaction,
            LockCall {
                call_id,
                actor: None,
            },
        )
        .await?;
        self.require_media_access(&mut transaction, &call).await?;
        let room = ready_room(&mut transaction, call.id).await?;

        // A provider refresh extends JWT lifetime. The application owns the join cutoff.
        let is_participant = identity.participant == room.caller_identity
            || identity.participant == room.recipient_identity;
        if !is_participant || identity.room != room.room_name {
            return Err(AccountError::Forbidden);
        }
        transaction.commit().await?;

        Ok(())
    }

    async fn require_media_access(
        &self,
        connection: &mut PgConnection,
        call: &CallRow,
    ) -> Result<(), AccountError> {
        if !matches!(call.phase, CallPhase::Connecting | CallPhase::Active) {
            return Err(AccountError::Forbidden);
        }

        self.calls.authorize_call(connection, call).await?;
        let now = database_now(connection).await?;
        if call.deadline().is_some_and(|deadline| deadline <= now) {
            return Err(AccountError::Forbidden);
        }

        Ok(())
    }
}

async fn find_call(
    connection: &mut PgConnection,
    identity: &ProviderIdentity,
) -> Result<Uuid, AccountError> {
    let lookup = sqlx::query_scalar(
        "SELECT call_id FROM call_rooms WHERE room_name = $1
         AND (caller_identity = $2 OR recipient_identity = $2)",
    );
    let lookup = lookup.bind(&identity.room).bind(identity.participant);
    let call_id = lookup.fetch_optional(connection).await?;

    call_id.ok_or(AccountError::Forbidden)
}

async fn ready_room(
    connection: &mut PgConnection,
    call_id: Uuid,
) -> Result<CallRoom, AccountError> {
    let query = sqlx::query_as::<_, CallRoom>(
        "SELECT room_name, caller_identity, recipient_identity, provider_sid
         FROM call_rooms WHERE call_id = $1",
    );
    let room = query.bind(call_id).fetch_optional(connection).await?;
    let room = room.filter(|room| room.provider_sid.is_some());

    room.ok_or(AccountError::CallRoomPending)
}
