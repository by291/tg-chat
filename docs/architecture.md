# Product and runtime architecture

TG Chat is a cloud chat service with a React frontend and a Rust backend. Registered accounts can
exchange direct messages, use a private Saved Messages conversation, discover public groups and
channels, and join private communities by invitation. Voice and video calls start from an existing
direct conversation. PostgreSQL is the authority for identity, access, and durable state.

The product uses server-side authorization and transport encryption in deployments with TLS.
End-to-end encryption, federation, Telegram protocol integration, anonymous history access,
organization tenancy, native apps, bots, billing, stories, group calls, screen sharing, and call
recording are outside the product scope. The explicit demo uses its own local state and does not
import that history into a registered account.

## Process and storage boundaries

The root Rust project builds separate API and Worker processes. Both share the feature modules and
PostgreSQL transactions. The API serves authenticated reads, commits user actions, and issues scoped
credentials. The Worker performs delayed and retryable work, including media preparation, realtime
publication, notifications, and cleanup. Separate process lifecycles allow either process to restart
without redeploying the other. See [backend development](./development.md#backend-source-layout).

- **Caddy.** Serve the frontend and proxy public HTTP, realtime, and authorized call signaling.
- **PostgreSQL.** Own business records, access rules, receipts, personal change feeds, and
  durable jobs.
- **Valkey.** Hold disposable admission counters, activity leases, and Centrifugo broker state.
- **Centrifugo.** Wake connected clients so they can catch up through the API.
- **RustFS.** Store private objects and variants. PostgreSQL owns their references and
  authorization.
- **LiveKit.** Transport call media. The application owns call admission, state, and history.

Email and calls can be disabled independently of chat. RustFS and the private link-preview fetcher
are separate from message acceptance. See [runtime operations](./operations.md) for deployment
boundaries and service failure behavior.

## Consistency across services

The API commits the business change, replay identity, personal feed entries, and wakeup intent in
one transaction where the action requires them. A realtime hint does not advance a browser
checkpoint. Clients advance it by consuming ordered HTTP sync responses. A retained feed prefix
may expire, in which case clients rebuild canonical state while preserving locally pending work.
See [durable messaging](./messaging.md#acceptance-and-ownership).

Keep locks within the business transaction and do network calls and media processing outside it.
Worker leases fence database completion. An external provider can still act after a lease expires
or a response is lost, so retryable operations need stable identities or reconciliation. See
[realtime and maintenance](./messaging.md#realtime-and-maintenance) and
[private media](./media.md#sending-and-recovery).

The frontend keeps authenticated session resources, canonical cache, durable pending operations,
and transient UI state at their respective lifetimes. See [frontend architecture][frontend].
The [release acceptance checklist](./release-acceptance.md) records open deployment and capability
checks.

[frontend]: ../web/docs/architecture.md
