use std::{sync::Arc, time::Duration};

use redis::aio::ConnectionManager;
use tokio::{sync::OnceCell, time::timeout};
use uuid::Uuid;

use crate::features::accounts::{AccountError, transport::HttpSettings};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
const FOREGROUND_MS: u32 = 45_000;
const TYPING_MS: u32 = 6_000;
const TYPING_REFRESH_MS: u32 = 2_000;
const FENCE_MS: u32 = 90_000;
const TAB_LIMIT: usize = 32;

// Each session owns one bounded hash. The tab sequence survives a stop so delayed requests
// cannot reopen a backgrounded tab. Use the cache server's time across API replicas.
const UPDATE_SCRIPT: &str = "
local time = redis.call('TIME')
local now = time[1] * 1000 + math.floor(time[2] / 1000)
local key = KEYS[1]
local tab = ARGV[1]
local sequence = tonumber(ARGV[2])
local action = ARGV[3]
local view = ARGV[4]
local foreground_ms = tonumber(ARGV[5])
local typing_ms = tonumber(ARGV[6])
local typing_refresh_ms = tonumber(ARGV[7])
local fence_ms = tonumber(ARGV[8])
local tab_limit = tonumber(ARGV[9])
local unchanged = {'', ''}

local rows = redis.call('HGETALL', key)
local current
local count = 0
for index = 1, #rows, 2 do
    local saved = cjson.decode(rows[index + 1])
    if saved.fenced_until <= now then
        redis.call('HDEL', key, rows[index])
    else
        count = count + 1
        if rows[index] == tab then
            current = saved
        end
    end
end
if current and sequence <= current.sequence then
    return unchanged
end

local is_heartbeat = action == 'foreground' or action == 'background'
if not current then
    if not is_heartbeat or count >= tab_limit then
        return unchanged
    end
    current = {foreground_until = 0, typing_until = 0, view = ''}
end

local hints = unchanged
if is_heartbeat then
    local previous = ''
    if current.foreground_until > now then
        previous = current.view
    end
    if action == 'foreground' then
        current.foreground_until = now + foreground_ms
    else
        current.foreground_until = 0
    end
    if previous ~= view or previous == '' then
        current.typing_until = 0
    end
    current.view = view
    if previous ~= view then
        hints = {previous, view}
    end
elseif current.foreground_until > now and current.view == view then
    if action == 'stop_typing' then
        if current.typing_until > now then
            hints = {view, ''}
        end
        current.typing_until = 0
    elseif now >= current.typing_until - typing_ms + typing_refresh_ms then
        current.typing_until = now + typing_ms
        hints = {view, ''}
    end
end

current.sequence = sequence
current.fenced_until = now + fence_ms
redis.call('HSET', key, tab, cjson.encode(current))
redis.call('PEXPIRE', key, fence_ms)
return hints
";

// Return remaining lifetime from the same time sample for every lease in an observation.
const READ_SCRIPT: &str = "
local time = redis.call('TIME')
local now = time[1] * 1000 + math.floor(time[2] / 1000)
local first_view = ARGV[1]
local other_views = ARGV[2]
local tab = ARGV[3]
local result = {}
for index, key in ipairs(KEYS) do
    local view = index == 1 and first_view or other_views
    local leases
    if index == 1 and tab ~= '' then
        local selected = redis.call('HGET', key, tab)
        leases = selected and {selected} or {}
    else
        leases = redis.call('HVALS', key)
    end

    local online = 0
    local viewing = 0
    local typing = 0
    for _, lease in ipairs(leases) do
        local current = cjson.decode(lease)
        local remaining = current.foreground_until - now
        if remaining > 0 then
            online = math.max(online, remaining)
            if view ~= '' and current.view == view then
                viewing = math.max(viewing, remaining)
                typing = math.max(typing, math.min(remaining, current.typing_until - now))
            end
        end
    end
    result[index] = {online, viewing, typing}
end
return result
";

#[derive(Clone)]
pub(super) struct ActivityStore {
    client: redis::Client,
    connection: Arc<OnceCell<ConnectionManager>>,
    namespace: String,
}

pub(super) enum ActivityAction {
    Foreground,
    Background,
    Typing,
    StopTyping,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct ActivityViewKey {
    pub conversation_id: Uuid,
    pub generation: i64,
}

pub(super) struct ActivityMutation {
    pub session_id: Uuid,
    pub tab_id: Uuid,
    pub sequence: u32,
    pub action: ActivityAction,
    pub view: Option<ActivityViewKey>,
}

pub(super) struct ActivityLease {
    pub online_for_ms: u32,
    pub viewing_for_ms: u32,
    pub typing_for_ms: u32,
}

#[derive(Default)]
pub(super) struct ActivityLookup<'sessions> {
    pub session_ids: &'sessions [Uuid],
    pub first_session_tab: Option<Uuid>,
    pub first_view: Option<ActivityViewKey>,
    pub other_views: Option<ActivityViewKey>,
}

impl ActivityViewKey {
    fn encode(self) -> String {
        format!("{}:{}", self.conversation_id, self.generation)
    }
}

impl ActivityAction {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Foreground => "foreground",
            Self::Background => "background",
            Self::Typing => "typing",
            Self::StopTyping => "stop_typing",
        }
    }
}

impl ActivityStore {
    /// Open Valkey lazily so deployments can keep durable chat available during cache loss.
    pub(super) fn new(settings: &HttpSettings) -> Self {
        Self {
            client: redis::Client::open(settings.valkey_url.as_str())
                .expect("validated Valkey URL"),
            connection: Arc::new(OnceCell::new()),
            namespace: settings.rate_namespace.clone(),
        }
    }

    fn session_key(&self, session_id: Uuid) -> String {
        format!("{}:activity:session:{session_id}", self.namespace)
    }

    async fn connection(&self) -> Result<ConnectionManager, AccountError> {
        let connection = self
            .connection
            .get_or_try_init(|| self.client.get_connection_manager())
            .await
            .map_err(|_| AccountError::Unavailable)?;

        Ok(connection.clone())
    }

    /// Apply one ordered tab update and return the direct views whose hints changed.
    pub(super) async fn update(
        &self,
        mutation: ActivityMutation,
    ) -> Result<Vec<Uuid>, AccountError> {
        let operation = async {
            let mut connection = self.connection().await?;
            let script = redis::Script::new(UPDATE_SCRIPT);
            let mut invocation = script.prepare_invoke();
            let view = mutation.view.map_or_else(String::new, ActivityViewKey::encode);
            invocation.key(self.session_key(mutation.session_id));
            invocation.arg(mutation.tab_id.to_string()).arg(mutation.sequence);
            invocation.arg(mutation.action.as_str()).arg(view);
            invocation.arg(FOREGROUND_MS).arg(TYPING_MS).arg(TYPING_REFRESH_MS);
            invocation.arg(FENCE_MS).arg(TAB_LIMIT);

            let changed: Vec<String> = invocation
                .invoke_async(&mut connection)
                .await
                .map_err(|_| AccountError::Unavailable)?;
            let mut direct_views: Vec<Uuid> =
                changed.iter().filter_map(|view| hinted_conversation(view)).collect();
            direct_views.dedup();

            Ok(direct_views)
        };

        timeout(REQUEST_TIMEOUT, operation).await.map_err(|_| AccountError::Unavailable)?
    }

    /// Fetch bounded session snapshots and optionally scope the first session to one tab.
    pub(super) async fn leases(
        &self,
        lookup: ActivityLookup<'_>,
    ) -> Result<Vec<ActivityLease>, AccountError> {
        let operation = async {
            let mut connection = self.connection().await?;
            let script = redis::Script::new(READ_SCRIPT);
            let mut invocation = script.prepare_invoke();
            for session_id in lookup.session_ids {
                invocation.key(self.session_key(*session_id));
            }
            let first_view = lookup.first_view.map_or_else(String::new, ActivityViewKey::encode);
            let other_views = lookup.other_views.map_or_else(String::new, ActivityViewKey::encode);
            let tab = lookup.first_session_tab.map_or_else(String::new, |id| id.to_string());
            invocation.arg(first_view).arg(other_views).arg(tab);

            let durations: Vec<(u32, u32, u32)> = invocation
                .invoke_async(&mut connection)
                .await
                .map_err(|_| AccountError::Unavailable)?;
            let leases = durations
                .into_iter()
                .map(|(online_for_ms, viewing_for_ms, typing_for_ms)| ActivityLease {
                    online_for_ms,
                    viewing_for_ms,
                    typing_for_ms,
                })
                .collect();
            Ok(leases)
        };

        timeout(REQUEST_TIMEOUT, operation).await.map_err(|_| AccountError::Unavailable)?
    }
}

fn hinted_conversation(view: &str) -> Option<Uuid> {
    let (conversation, _) = view.split_once(':')?;
    Uuid::parse_str(conversation).ok()
}
