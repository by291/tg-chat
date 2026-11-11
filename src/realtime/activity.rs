use std::time::Instant;

use serde::{Deserialize, Serialize};
use sqlx::{AssertSqlSafe, FromRow};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use super::{
    RealtimeClient,
    activity_store::{
        ActivityAction, ActivityLookup, ActivityMutation, ActivityStore, ActivityViewKey,
    },
};
use crate::{
    accounts::{AccountError, AccountService, Actor, transport::HttpSettings},
    messages::service::verify_actor,
};

const DIRECT_MEMBERSHIPS: &str = "
    SELECT member.user_id, viewer.generation AS viewer_generation,
           member.generation AS subject_generation
    FROM conversations conversation
    JOIN conversation_members viewer ON viewer.conversation_id = conversation.id
        AND viewer.user_id = $1 AND viewer.directory_active AND NOT viewer.is_banned
    JOIN conversation_members member ON member.conversation_id = conversation.id
        AND member.user_id = CASE
            WHEN conversation.participant_low = $1 THEN conversation.participant_high
            WHEN conversation.participant_high = $1 THEN conversation.participant_low
        END
        AND member.directory_active AND NOT member.is_banned
    WHERE conversation.id = $2 AND conversation.kind = 'direct'
        AND conversation.deleted_at IS NULL AND NOT conversation.is_quarantined
";

#[derive(Clone)]
pub struct Activity {
    accounts: AccountService,
    store: ActivityStore,
    realtime: Option<RealtimeClient>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct ActivityHeartbeat {
    pub tab_id: Uuid,
    pub sequence: String,
    pub is_foreground: bool,
    pub conversation_id: Option<Uuid>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct ActivityTyping {
    pub tab_id: Uuid,
    pub sequence: String,
    pub is_typing: bool,
}

#[derive(Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub(crate) struct ActivityPresenceQuery {
    pub tab_id: Option<Uuid>,
    pub conversation_id: Option<Uuid>,
}

#[derive(Default, Serialize, ToSchema)]
pub(crate) struct ActivityPresence {
    pub online_for_ms: u32,
    pub typing_for_ms: u32,
}

struct PresenceScope {
    viewer_id: Uuid,
    subject_id: Uuid,
    conversation_id: Option<Uuid>,
}

#[derive(FromRow)]
struct DirectPeer {
    user_id: Uuid,
    viewer_generation: i64,
}

#[derive(Default, FromRow)]
struct PresencePolicy {
    is_contact: bool,
    viewer_generation: Option<i64>,
    subject_generation: Option<i64>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct DirectViews {
    viewer: ActivityViewKey,
    subject: ActivityViewKey,
}

impl PresencePolicy {
    fn views(&self, conversation_id: Uuid) -> Option<DirectViews> {
        Some(DirectViews {
            viewer: ActivityViewKey {
                conversation_id,
                generation: self.viewer_generation?,
            },
            subject: ActivityViewKey {
                conversation_id,
                generation: self.subject_generation?,
            },
        })
    }
}

impl Activity {
    /// Use PostgreSQL for activity authorization and Valkey for disposable tab leases.
    pub fn new(
        accounts: AccountService,
        settings: &HttpSettings,
        realtime: Option<RealtimeClient>,
    ) -> Self {
        Self {
            accounts,
            store: ActivityStore::new(settings),
            realtime,
        }
    }

    /// Report foreground activity only for a currently valid session with a live tab lease.
    pub async fn is_foreground(&self, session_id: Uuid) -> bool {
        let lookup = ActivityLookup {
            session_ids: &[session_id],
            ..Default::default()
        };
        let started_at = Instant::now();
        let Ok(leases) = self.store.leases(lookup).await else {
            return false;
        };
        let Some(lease) = leases.first() else {
            return false;
        };
        if remaining(lease.online_for_ms, started_at) == 0 {
            return false;
        }

        let query = sqlx::query_as::<_, Actor>(
            "SELECT users.id AS user_id, sessions.id AS session_id
             FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = $1",
        );
        let actor = query.bind(session_id).fetch_optional(&self.accounts.pool).await;
        let Ok(Some(actor)) = actor else {
            return false;
        };

        self.verify(&actor).await.is_ok() && remaining(lease.online_for_ms, started_at) > 0
    }

    /// Update one foreground tab and retain a direct view only while both peers have access.
    pub(crate) async fn heartbeat(
        &self,
        actor: &Actor,
        input: ActivityHeartbeat,
    ) -> Result<(), AccountError> {
        let action = if input.is_foreground {
            ActivityAction::Foreground
        } else {
            ActivityAction::Background
        };
        let view = match input.conversation_id.filter(|_| input.is_foreground) {
            // An inaccessible view must not invalidate the session's foreground lease.
            Some(conversation_id) => {
                let peer = self.direct_peer(actor.user_id, conversation_id).await?;
                peer.map(|peer| ActivityViewKey {
                    conversation_id,
                    generation: peer.viewer_generation,
                })
            }
            None => None,
        };
        self.verify(actor).await?;

        self.update(
            actor,
            ActivityMutation {
                session_id: actor.session_id,
                tab_id: input.tab_id,
                sequence: parse_sequence(&input.sequence)?,
                action,
                view,
            },
        )
        .await
    }

    /// Refresh or stop typing on an already foreground, authorized direct tab.
    pub(crate) async fn typing(
        &self,
        actor: &Actor,
        conversation_id: Uuid,
        input: ActivityTyping,
    ) -> Result<(), AccountError> {
        self.verify(actor).await?;
        let peer = self
            .direct_peer(actor.user_id, conversation_id)
            .await?
            .ok_or(AccountError::NotFound)?;
        let scope = PresenceScope {
            viewer_id: peer.user_id,
            subject_id: actor.user_id,
            conversation_id: Some(conversation_id),
        };
        let policy = self.policy(&scope).await?;
        if input.is_typing && policy.views(conversation_id).is_none() {
            return Ok(());
        }
        let action = if input.is_typing {
            ActivityAction::Typing
        } else {
            ActivityAction::StopTyping
        };

        self.update(
            actor,
            ActivityMutation {
                session_id: actor.session_id,
                tab_id: input.tab_id,
                sequence: parse_sequence(&input.sequence)?,
                action,
                view: Some(ActivityViewKey {
                    conversation_id,
                    generation: peer.viewer_generation,
                }),
            },
        )
        .await
    }

    /// Read coarse activity for a contact or the peer of the caller's foreground direct tab.
    pub(crate) async fn presence(
        &self,
        actor: &Actor,
        user_id: Uuid,
        input: ActivityPresenceQuery,
    ) -> Result<ActivityPresence, AccountError> {
        self.verify(actor).await?;
        let direct_view = input.tab_id.and(input.conversation_id);
        let scope = PresenceScope {
            viewer_id: actor.user_id,
            subject_id: user_id,
            conversation_id: direct_view,
        };
        let initial_policy = self.policy(&scope).await?;
        let initial_views = direct_view.and_then(|id| initial_policy.views(id));
        if !initial_policy.is_contact && initial_views.is_none() {
            return Err(AccountError::NotFound);
        }
        let subject_sessions = self.live_sessions(user_id).await?;
        let mut session_ids = vec![actor.session_id];
        session_ids.extend(subject_sessions.iter().copied());
        let lookup = ActivityLookup {
            session_ids: &session_ids,
            first_session_tab: input.tab_id,
            first_view: initial_views.map(|views| views.viewer),
            other_views: initial_views.map(|views| views.subject),
        };

        let started_at = Instant::now();
        let leases = self.store.leases(lookup).await?;

        // A cache read can finish after privacy, membership, or session revocation changes.
        self.verify(actor).await?;
        let current_sessions = self.live_sessions(user_id).await?;
        let policy = self.policy(&scope).await?;
        let viewing_for_ms = leases.first().map_or(0, |lease| lease.viewing_for_ms);
        let current_views = direct_view.and_then(|id| policy.views(id));
        // A reopened membership must not inherit view or typing from its previous generation.
        let view_lifetime = if current_views == initial_views {
            remaining(viewing_for_ms, started_at)
        } else {
            0
        };
        let can_view_direct = view_lifetime > 0;
        if !policy.is_contact && !can_view_direct {
            return Err(AccountError::NotFound);
        }

        let mut result = ActivityPresence::default();
        for (session_id, lease) in subject_sessions.iter().zip(leases.iter().skip(1)) {
            if !current_sessions.contains(session_id) {
                continue;
            }
            result.online_for_ms = result.online_for_ms.max(lease.online_for_ms);
            result.typing_for_ms = result.typing_for_ms.max(lease.typing_for_ms);
        }
        result.online_for_ms = remaining(result.online_for_ms, started_at);
        if !policy.is_contact {
            result.online_for_ms = result.online_for_ms.min(view_lifetime);
        }
        result.typing_for_ms = remaining(result.typing_for_ms, started_at).min(view_lifetime);

        Ok(result)
    }

    async fn verify(&self, actor: &Actor) -> Result<(), AccountError> {
        let mut connection = self.accounts.pool.acquire().await?;
        verify_actor(&mut connection, actor, self.accounts.settings.idle_days).await
    }

    async fn update(&self, actor: &Actor, mutation: ActivityMutation) -> Result<(), AccountError> {
        let changed_views = self.store.update(mutation).await?;
        if let Some(realtime) = &self.realtime {
            for view in changed_views {
                // Activity hints carry no activity values. A recipient always refetches policy.
                let _ = self.publish_hint(realtime, actor, view).await;
            }
        }

        Ok(())
    }

    async fn publish_hint(
        &self,
        realtime: &RealtimeClient,
        actor: &Actor,
        conversation_id: Uuid,
    ) -> Result<(), AccountError> {
        let Some(peer) = self.direct_peer(actor.user_id, conversation_id).await? else {
            return Ok(());
        };
        let scope = PresenceScope {
            viewer_id: peer.user_id,
            subject_id: actor.user_id,
            conversation_id: Some(conversation_id),
        };
        let policy = self.policy(&scope).await?;
        let Some(views) = policy.views(conversation_id) else {
            return Ok(());
        };

        let session_ids = self.live_sessions(peer.user_id).await?;
        if session_ids.is_empty() {
            return Ok(());
        }
        let lookup = ActivityLookup {
            session_ids: &session_ids,
            first_session_tab: None,
            first_view: Some(views.viewer),
            other_views: Some(views.viewer),
        };
        let started_at = Instant::now();
        let leases = self.store.leases(lookup).await?;
        let current_sessions = self.live_sessions(peer.user_id).await?;
        self.verify(actor).await?;
        let current_policy = self.policy(&scope).await?;
        if current_policy.views(conversation_id) != Some(views) {
            return Ok(());
        }
        let has_viewer = session_ids.iter().zip(leases.iter()).any(|(session_id, lease)| {
            current_sessions.contains(session_id) && remaining(lease.viewing_for_ms, started_at) > 0
        });
        if has_viewer {
            realtime.publish_activity_hint(peer.user_id).await?;
        }

        Ok(())
    }

    async fn direct_peer(
        &self,
        viewer_id: Uuid,
        conversation_id: Uuid,
    ) -> Result<Option<DirectPeer>, AccountError> {
        let query = sqlx::query_as(DIRECT_MEMBERSHIPS).bind(viewer_id).bind(conversation_id);
        Ok(query.fetch_optional(&self.accounts.pool).await?)
    }

    async fn policy(&self, scope: &PresenceScope) -> Result<PresencePolicy, AccountError> {
        let statement = format!(
            "SELECT EXISTS (SELECT 1 FROM contacts WHERE owner_id = $1 AND target_id = $3)
                 AS is_contact, direct.viewer_generation, direct.subject_generation
             FROM users viewer
             CROSS JOIN users subject
             LEFT JOIN LATERAL ({DIRECT_MEMBERSHIPS}) direct ON direct.user_id = subject.id
             WHERE viewer.id = $1 AND subject.id = $3 AND $1 <> $3
                 AND NOT viewer.is_suspended AND NOT subject.is_suspended
                 AND (subject.presence_audience = 'everyone'
                     OR (subject.presence_audience = 'contacts' AND EXISTS (
                         SELECT 1 FROM contacts WHERE owner_id = $3 AND target_id = $1)))
                 AND NOT EXISTS (SELECT 1 FROM blocks
                     WHERE (owner_id = $1 AND target_id = $3)
                        OR (owner_id = $3 AND target_id = $1))",
        );
        // Both SQL fragments are static; request values only enter as bound parameters.
        let query = sqlx::query_as(AssertSqlSafe(statement));
        let query = query.bind(scope.viewer_id).bind(scope.conversation_id);
        let query = query.bind(scope.subject_id);
        let policy: Option<PresencePolicy> = query.fetch_optional(&self.accounts.pool).await?;

        Ok(policy.unwrap_or_default())
    }

    async fn live_sessions(&self, user_id: Uuid) -> Result<Vec<Uuid>, AccountError> {
        let query = sqlx::query_scalar(
            "SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL
             AND expires_at > now()
             AND last_seen_at > now() - ($2::bigint * interval '1 day')",
        );
        let query = query.bind(user_id).bind(self.accounts.settings.idle_days);

        Ok(query.fetch_all(&self.accounts.pool).await?)
    }
}

fn remaining(duration_ms: u32, started_at: Instant) -> u32 {
    let elapsed_ms = u32::try_from(started_at.elapsed().as_millis()).unwrap_or(u32::MAX);
    duration_ms.saturating_sub(elapsed_ms)
}

fn parse_sequence(value: &str) -> Result<u32, AccountError> {
    let invalid_sequence = AccountError::Validation("invalid activity sequence");
    let sequence: u32 = value.parse().map_err(|_| invalid_sequence)?;
    if sequence.to_string() != value {
        return Err(AccountError::Validation("invalid activity sequence"));
    }

    Ok(sequence)
}
