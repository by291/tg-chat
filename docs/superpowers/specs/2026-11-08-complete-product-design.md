# TG Chat complete product design

Status: Approved by the owner on 2026-11-08, including the default product rules. This describes the
target product, not implemented behavior.

## 1. Intent and decisions

Build a small, publicly registerable chat service around the existing React frontend. The result
must support real users, reliable messaging, multiple devices, private files, and manageable
operations. Preserve the frontend's editing, media, and history-navigation quality while replacing
local simulation with server-authoritative behavior.

The owner has confirmed these decisions:

- Registration uses a username and password. Email is optional and can be added later.
- Groups and channels support public discovery and private invitations, including join approval.
- Messages use a conventional cloud model without end-to-end encryption.
- One-to-one voice and video calls belong in the final product and use LiveKit. Implement them
  separately after the messaging foundation; this document does not assign milestones.
- Rust lives at the repository root. Keep the existing `web/` frontend; do not add a backend wrapper
  directory.
- One Rust project provides separate API and Worker processes sharing business modules.
- PostgreSQL, Valkey, RustFS through S3, and Centrifugo are available. Docker Compose is the
  deployment and integration-environment baseline.

The owner also approved the defaults below as the implementation baseline. Adjustable limits remain
product policy, not performance claims; deployment measurements may tune them without changing the
agreed permission and consistency semantics.

### Goals

- Complete the existing chat capabilities with server-enforced identity, authorization, and state.
- Preserve accepted messages across worker, realtime, and application restarts.
- Make retries safe and let reconnecting devices converge without loading all history.
- Keep one understandable codebase, one business database, and repeatable operations.
- Include minimal account and content administration for an openly registerable service.
- Make the target precise enough to plan implementation without reopening fundamental contracts.

### Non-goals

No Telegram account or protocol integration, federation, organization tenancy, native mobile apps,
bots, billing, stories, group calls, screen sharing, call recording, or end-to-end encryption. There
is no anonymous access to message history. Public discovery means discovery by registered users.
Search-engine indexing of public channels is outside this target.

Do not build a general workflow engine, adopt event sourcing for every entity, or split business
modules into independently deployed microservices. Do not treat cache contents, WebSocket delivery,
or a client's clock as business authority.

### Planning envelope

Use an initial verification workload of 1,000 registered users, 100 simultaneously connected
clients, and 10 accepted message sends per second spread across 20 active conversations. Include a
200-member group and a 500-subscriber channel in separate fanout stress cases. Use a million-message
history dataset to expose pagination and search mistakes. These are agreed test scenarios, not
guarantees for unspecified hardware or a requirement to support every maximum simultaneously.

Default limits include 200 directory memberships per account plus its reserved saved conversation,
1,000 saved contacts per account, 200 members per group, 500 subscribers per channel, and 10
simultaneous one-to-one calls per deployment. Limits are configurable, enforced on the server,
returned through capabilities, and validated against measured hardware before launch. Raising
membership limits requires checking transaction fanout costs.

## 2. Current frontend and integration boundary

The frontend already has rich composition, typed media, conversation management, reactions, polls,
checklists, forwarding, virtual history, search, and appearance preferences. Its authority is a
local conversation reducer backed by IndexedDB snapshots. The current identity is fixed, history is
held in memory, and attachments can contain Data URLs. Delivery marks mean local storage, not
delivery.

Keep the domain command boundary, existing renderers, Lexical editing, and scroll ownership. Replace
the local authority and history source. Do not insert networking into individual bubbles. Separate
server DTOs, cached entities, pending operations, and display models; existing domain schemas are a
starting point rather than a database or public API contract.

Specific changes required by the target:

- Replace the fixed current-user identity with the authenticated account and capabilities.
- Replace whole-workspace message snapshots with bounded history pages and indexed cached entities.
- Replace implicit local dispatch success with pending, accepted, rejected, and retryable outcomes.
- Represent reaction membership and poll participation per user, rather than as local aggregates.
- Replace durable Data URLs and source URL identity with file IDs and authorized access requests.
- Derive previews, timestamps, member counts, permissions, and delivery states from canonical
  values.
- Preserve stable rendering keys when optimistic messages receive authoritative responses.
- Keep demo fixtures only in explicit demo/development mode. Never upload a user's existing demo
  history into a newly registered account automatically.

The existing frontend designs remain authoritative for rendering and editor behavior:
[architecture](../../../web/docs/architecture.md), [history](../../../web/docs/message-history.md),
and [editing](../../../web/docs/editing-and-interactions.md).

## 3. Approaches and selected structure

Two practical approaches were discussed:

1. One process runs both HTTP and background work. This has the smallest process count but couples
   request serving to media processing, retries, and worker restarts.
2. One project exposes API and Worker binaries. They share business code and PostgreSQL
   transactions, but have separate resource budgets, health checks, and restart lifecycles.

The owner selected the second approach. Microservices would introduce distributed business
transactions and extra operational boundaries without a demonstrated need at this scale.

### Runtime responsibilities

- Rust API authenticates requests, authorizes actions, validates input, commits business changes,
  serves reads and synchronization, and issues upload and call credentials.
- Rust Worker claims durable PostgreSQL jobs, publishes realtime wakeups, processes media, sends
  notifications and email, expires messages, and cleans abandoned resources.
- PostgreSQL stores business facts, authorization, idempotency receipts, per-user change records,
  and durable jobs.
- Valkey stores disposable caches, rate-limit state, typing/presence leases, and Centrifugo broker
  data. Business recovery must work after its contents are lost.
- RustFS stores private original objects and generated variants. File ownership and references
  remain in PostgreSQL.
- Centrifugo transports personal realtime wakeups and transient presence/typing events. Durable
  synchronization comes from the Rust API.
- LiveKit handles media transport and its own room signaling. Rust owns product call state and
  permission to join a particular call.

The primary write path is browser to Rust API to PostgreSQL. A committed job wakes Centrifugo, which
prompts clients to synchronize through the API. Media bytes use S3; call media uses LiveKit.

### Repository and technology choices

Use root `Cargo.toml`, `Cargo.lock`, `src/lib.rs`, `src/bin/api.rs`, `src/bin/worker.rs`,
`migrations/`, `tests/`, `compose.yaml`, and `docs/`. Runtime configuration and container assets
belong in `deploy/` when introduced. Keep frontend code and its package manager in `web/`.

Use Tokio, Axum, SQLx with PostgreSQL and explicit SQL migrations, Serde, tracing, and an OpenAPI
contract. Prefer straightforward transactions over a generic repository abstraction. Use a
maintained S3 client, Valkey-compatible Rust client, and the official LiveKit Rust server SDK. Exact
compatible versions are pinned during implementation, not inferred from this document.

Business modules follow responsibilities: accounts, contacts, conversations, messages, media, sync,
notifications, calls, and moderation. Infrastructure adapters handle database, S3, realtime, mail,
and LiveKit integration. API handlers and worker jobs call the same application operations. Domain
rules must not depend on HTTP request types. Avoid wrapper modules without a responsibility.

Use Rustfmt and Clippy for Rust. Continue using the frontend's existing Prettier configuration and
pnpm. Generate TypeScript API types from OpenAPI; keep runtime validation at external boundaries.

## 4. Accounts, sessions, and privacy

### Registration and recovery

Register with a unique username and password; a display name is separate and need not be unique.
Usernames are case-insensitive ASCII letters, digits, and underscores, with a length of 3 to 32
characters. Normalize before uniqueness checks and reserve system names. User IDs never change. Keep
usernames immutable in this target; display names, avatars, and biographies are editable.

Passwords allow long passphrases and Unicode without silent truncation. Store Argon2id password
hashes with independently generated salts. Tune cost on deployment hardware; rate limiting protects
the expensive verification path. Do not log credentials or password-reset tokens.

Email is private and optional. Verify ownership before enabling recovery. A verified email belongs
to at most one active account. Changing or removing it requires recent password authentication;
changing it verifies the replacement before replacing the previous recovery address. Recovery tokens
are random, stored hashed, short-lived, and single-use. Reset responses do not reveal whether an
account exists. Password reset revokes all sessions. Password change revokes other sessions and
rotates the current one. Without verified email there is no self-service forgotten-password flow.
Administrators cannot recover an account solely from a claimed username.

### Browser session model

Use opaque random session tokens in Secure, HttpOnly, SameSite cookies. PostgreSQL stores only token
hashes, user/session identity, creation, expiry, last activity, and revocation state. Check session
validity against PostgreSQL for authenticated requests; avoid a revocation-sensitive cache.
State-changing requests require CSRF protection and accepted Origin checks. Deploy the frontend,
API, and Centrifugo WebSocket entry through the same origin.

An account may have multiple sessions and browser tabs. Device information is descriptive, not an
authentication factor. Session expiry is explicit; activity updates can be coalesced. Users can
revoke one session, all other sessions, or log out. Revocation also disconnects matching realtime
connections and terminates calls owned by that session. In-flight transactions authorized before a
revocation commits can finish; subsequent authorization must fail. Sensitive operations recheck
account/session state inside their transaction.

Logout and account switching clear private client caches, revoke local pending-operation ownership,
and detach push subscriptions. Namespace all local persistence by account and server deployment.
Browser cache removal cannot retract files or text the user already copied.

### Contacts and privacy defaults

Contacts are directional saved relationships, not mutual friendship approvals. Adding a contact does
not disclose the other person's contact list or email. Username lookup and bounded display-name
search are available to authenticated users. Phone numbers are optional profile/contact-card data,
never an authentication requirement or globally searchable directory field.

By default, any unblocked registered user may start a direct conversation. Incoming calls are
limited to people in the recipient's contacts; settings can allow everyone or nobody. Users can
block direct messages and calls from another account. Shared-group messages remain visible after
blocking; moderation and leaving a group are separate controls. Blocking ends an active direct call.
Presence visibility defaults to contacts and can be disabled. Do not expose exact last-seen times to
unauthorized users. Group membership lists are visible to members; channel subscriber lists are
visible only to channel administrators and the subscriber concerned.

Account deletion requires recent authentication, revokes sessions, cancels calls, and removes
credentials and private account settings. Existing shared messages remain attributed to a deleted
account unless separately deleted under message rules. The user must transfer ownership or delete
owned groups/channels before deletion can finish. State this behavior before accepting deletion.

## 5. Conversations, discovery, and authorization

### Conversation types

- Direct: one canonical conversation per unordered user pair, protected by a database uniqueness
  constraint. The first accepted message creates visibility for both accounts.
- Saved: one private conversation owned by an account, with the same history and media capabilities.
- Group: members discuss; the owner and administrators control membership and moderation.
- Channel: the owner and administrators publish as the channel; subscribers read and may participate
  in enabled reactions, polls, and checklists. Comments and linked discussion groups are excluded.

Each group/channel has one owner, administrators, and ordinary members/subscribers. Administrators
can manage ordinary members, invite links, join requests, pins, and inappropriate messages. Only the
owner transfers ownership, appoints/removes administrators, or deletes the conversation. A group
member can be muted or banned. A ban survives leaving and invalidates future join attempts until
removed. Administrator power does not include editing another person's message as that person.

Every API query, mutation, history jump, search result, file access, and interactive-message action
checks the same authorization policy. Hidden UI controls are not enforcement. Mutations evaluate
membership, ban, block, and role state inside the transaction, serialized with relevant changes.

### Public and private membership

Public discovery exposes title, public handle, description, avatar, and approximate member count. It
does not expose messages. Users join directly or submit a request if approval is enabled. Search
results exclude banned or deleted conversations. Private conversations are absent from discovery.
Invite tokens are high-entropy secrets stored hashed, can expire, can have a use limit, and can be
revoked. Joining consumes a use atomically. Preview reveals only the minimum identity of the invited
conversation. Direct invitations require acceptance and cannot force another account in.

All admitted members can read the retained history, including messages before joining. This is an
explicit default for both public and private conversations. Leaving, removal, or a ban removes all
server access to that conversation's messages and files. Joining again restores retained history,
subject to the account's personal hide/clear settings. No configurable historical visibility modes
are included in the target. A privacy change from public to private removes discovery immediately,
preserves existing membership, and invalidates outstanding public join requests.

Membership and message publication serialize on the conversation record. Therefore a message is
committed either before or after a membership change, never against an ambiguous recipient set.
Former members receive an access-removal change so their applications purge cached content. Already
downloaded content cannot be remotely recalled.

### Personal conversation state

Pin order, mute duration, archive state, manual unread marker, and local history clearance belong to
the account, not the conversation. Synchronize them across devices. Marking unread does not move the
read receipt backwards. Opening a conversation alone does not mark all messages read.

Clearing history for oneself stores a per-user sequence cutoff; it does not delete other users'
messages. Hiding a direct chat removes it from the list; a new incoming message can reveal it again.
Deleting a group/channel from one's list means leaving, with confirmation. Only the owner can delete
the group/channel for everyone. Archive preferences determine whether new unmuted activity returns
an archived conversation to the inbox. An expiry policy belongs to the conversation and authorized
roles, not a personal mute/archive preference.

Directory capacity counts direct chats, groups, and channels, including archived and hidden entries;
the saved conversation has a separate reserved slot. Pending invitations and join requests do not
consume capacity. Creating or reopening a direct conversation checks both accounts' capacity in the
transaction. If the recipient lacks a slot, reject the initial send with a generic conversation-
unavailable error without exposing their counts. Existing conversations can continue receiving.
Hiding or archiving does not release a slot. A separate confirmed close-direct-chat action clears
personal history through the current sequence, removes that account's directory membership, and
releases its slot without changing the peer's history. A later incoming message can recreate the
entry only if privacy and capacity permit; the personal clear cutoff remains. Leaving a group or
channel releases a slot. Ownership must be transferred or the conversation deleted before its owner
can leave. Concurrent join/send/close operations lock account capacity records in stable order.

## 6. Message semantics

### Identity, ordering, and acceptance

Messages have a stable UUID, author identity, conversation ID, server timestamp, conversation-local
message sequence, content kind, content version, and optional reply/forward metadata. Numeric
database counters travel as decimal strings to avoid JavaScript precision loss. The server assigns
time and sequence; client timestamps do not order canonical history.

The client generates a message UUID and operation UUID before persisting its pending send. The
server binds the supplied message UUID to the authenticated actor and rejects collisions. A retry
with the same operation ID and canonical payload returns the original receipt. Reuse with a
different payload returns a conflict. A message's identity is never reused after deletion, including
after ordinary idempotency-receipt cleanup. Keep a minimal identity tombstone for deleted messages.

All mutating commands carry an operation ID. Store actor, operation ID, payload hash, and result in
the same transaction as the change. Retain general receipts for at least the supported offline retry
window; the default window is seven days. Clients do not silently replay older operations: they
reconcile the resource and ask the user to resubmit where necessary. Prefer idempotent desired
states such as setting a reaction or task completion over toggles.

Message acceptance commits the message, references, conversation summary, recipient unread state,
recipient change records, idempotency receipt, and required jobs atomically. Never call Centrifugo,
S3, or LiveKit while holding the business transaction. The API can return after commit without
waiting for realtime publication.

Client send states are queued, sending, accepted, and failed. A timeout after sending is ambiguous:
retry the same operation ID instead of creating another message. Accepted means committed to
PostgreSQL. Do not label this as delivered to a recipient's device. Direct chats also expose read
state from the other account's read cursor. Group member read receipts and channel view counts are
outside the target; provide account-specific unread counts instead.

### Content and rich text

Preserve the existing representation of plain text, sanitized semantic HTML, and UTF-16 custom emoji
ranges, with an explicit content schema version. Lexical state is not the transport format. The Rust
boundary sanitizes HTML independently using the supported tag/attribute policy, derives canonical
plain text, and checks custom-emoji alignment against it. Reject inconsistent ranges instead of
silently attaching emoji to the wrong text. Rust must count UTF-16 code units at this boundary, not
bytes or Unicode scalar values.

Rendering still sanitizes in the browser. Enforce limits on bytes, text length, markup nesting,
table dimensions, formula input, and entity count. Keep a shared contract fixture corpus for lists,
tables, spoilers, formulas, dates, links, and custom emoji. External image tags, scripts, inline
handlers, and arbitrary styles are not supported message content.

Support text, photos/albums, video, recorded voice messages, documents, links, contact cards,
bundled stickers/custom emoji, polls, checklists, and typed service events. Preserve existing
specialized rendering, including round-video display. Recording round videos and an online sticker
marketplace are excluded. Bundled assets keep their existing provenance notices. Server-managed
catalog IDs replace dependence on arbitrary client-provided asset paths.

### Editing, deletion, replies, and forwarding

Authors can edit their text/captions without a time limit while the message exists and they retain
posting permission. Edits require the expected content version; stale edits return a conflict with
the current authorized representation. Reactions and read receipts do not cause text-edit version
conflicts. Media replacement after sending is excluded; send a replacement message instead.

Authors can delete their own messages for everyone; group/channel administrators can delete messages
under their moderation authority. Any user can hide a visible message for themselves. Deleting
another user's direct message for everyone is not allowed. Shared deletion clears content, removes
search visibility and file references, and leaves a minimal tombstone. A reply to deleted or
inaccessible content displays an unavailable target rather than a retained private excerpt.

Replies target a message in the same conversation. Quote excerpts are validated against the source
and are scrubbed from accessible representations when the source becomes unavailable. Navigation
loads a bounded neighborhood around the target instead of every intervening message.

Forwarding creates new message identities and immutable attribution to the source author/channel. It
requires current source access and posting permission in the destination. Only the group/channel
owner controls that conversation's forwarding policy. Either direct-chat participant may disable
forwarding for the whole direct chat; re-enabling requires both participants' consent. The
saved-chat owner controls its policy. There is no per-message author override. Policy changes affect
future forward commands, not copies already created; the server enforces the current policy. This
control cannot prevent screenshots or manual copying. A forwarded copy survives source deletion and
retains its own authorized file references; explain this consequence in deletion UI. Attribution
never grants access to the source conversation. Polls and checklists forward as noninteractive
snapshots, excluding hidden results, quiz answers, or other unauthorized fields.

Bulk commands operate on one destination/conversation at a time with bounded batch sizes and one
transaction. Multi-destination forwarding reports independent destination outcomes and uses stable
per-destination operation IDs. It does not claim global atomicity across all destinations.

### Reactions, polls, and checklists

Reactions use unique message/user/emoji records. APIs set or remove a desired reaction; aggregates
and the current user's selection are projections. Enforce a bounded number per account per message.

Poll options have stable IDs. Voting replaces one account's selection under the poll lock, enforces
single/multiple choice, revoting policy, deadline, and membership, and counts distinct voters.
Non-revotable polls reject a different subsequent selection. Anonymous polls never expose voter
identities. Hidden results remain absent from API responses until the configured close time. Quiz
answers and explanations are not sent before the user has submitted or the poll has closed.
Question/settings/options cannot be edited after the first vote, except adding options when the poll
explicitly permits it. Quiz and anonymous polls cannot accept participant-added options. The author
or administrators can close a poll early. Deletion makes further participation fail.

Checklist task updates set a desired completion state with an expected task version. The creator and
permitted participants can complete or append tasks; other users cannot. Record who completed a
task. Stale conflicting writes return a conflict rather than accidentally toggling twice. Structural
edits use a separate checklist version. Forwarded checklists remain read-only.

### Read state and expiration

Each member has a monotonic read-through message sequence and a separate manual-unread flag. Advance
read-through only for messages actually reached in the foreground visible conversation. Jumping to
an old search result does not mark unseen newer history read. Unread counts include visible incoming
user messages after the cursor, excluding hidden, cleared, deleted, expired, self-authored, and
service messages. Update counters transactionally and provide a repair query against canonical
records. Reading on one device updates all devices.

Expiry policy values are disabled, one day, seven days, or thirty days. Group/channel owners or
administrators set the policy; either participant can change it for a direct chat, with a service
notice. The policy applies only to new messages and fixes their expiry at acceptance. Reads,
searches, media authorization, and interaction commands exclude expired messages immediately
according to server time, even if the cleanup worker is late. Cleanup emits deletion changes and
releases file references. Account UI explains that prior downloads and forwarded copies survive.

## 7. Durable synchronization and realtime transport

### Durable personal change feed

Each account has a PostgreSQL sync-head row and an ordered retained change feed. Changes identify
affected resources and their revisions; they do not store historical copies of private bodies.
Examples include message upserts/deletions, conversation changes, membership removal, read state,
draft versions, contact/settings changes, and call-state changes.

Allocate feed positions by updating a per-account counter under a row lock in the same transaction
as the changes. Do not use a PostgreSQL sequence or a timestamp as a commit-order cursor: a later
committed transaction could otherwise advance a client past an earlier uncommitted change. For
fanout, acquire recipient sync-head locks in stable user-ID order. Conversation mutations first
serialize on their conversation records; multi-resource operations use a documented common lock
order and bounded deadlock retries with the same operation identity.

At this product's bounded group/channel sizes, insert recipient change records synchronously in the
transaction. This deliberately trades write amplification for simple atomic visibility. Do not later
move fanout into an asynchronous worker without redesigning cursor and snapshot guarantees. Multiple
changes from one transaction are grouped so a paginated feed never exposes half of a logically
atomic update to one account.

### Bootstrap and catch-up

Bootstrap reads the account, contacts/settings, bounded conversation directory, memberships, and
sync cursor from one repeatable-read snapshot. It does not include all message history. The selected
conversation is loaded separately through the history API. Directory and contact caps bound
bootstrap size. Include archived/hidden directory entries and the saved conversation; reject
over-limit creation or joins rather than silently truncating required state. Do not embed member
lists or per-conversation media/history in bootstrap. Paginate those independently.

Clients connect to realtime, bootstrap, then request changes after the bootstrap cursor. Realtime
wakeups arriving during bootstrap merely trigger that catch-up. A bootstrap response and its cursor
must describe the same snapshot; the cursor cannot be read afterward in a separate transaction.

The sync API returns ordered change groups, a next cursor, and whether more groups remain. It
materializes the affected entities using current authorization and current canonical state, not a
past event payload. Deleted or inaccessible entities produce explicit removals. Personal projections
include only that user's permitted poll results, votes, file references, and conversation state.
Repeated references may coalesce inside a response as long as removals and latest versions survive.

Each response includes a snapshot observation cursor. Each resource includes its revision and, where
needed, membership/access generation. The client serializes sync application, ignores older
versions, persists entity changes and its cursor in one IndexedDB transaction, then advances its
checkpoint. A crash before that commit replays the same changes safely. Cache quota failure must not
advance a durable cursor independently of the associated state.

History/search requests carry account and view generations. Discard responses from an old account,
old membership generation, or a snapshot older than an applied invalidation for that conversation.
Refetch rather than allowing a late page to resurrect deleted content. Full reset invalidates all
in-flight requests, purges server-derived history, and reboots from a fresh snapshot while retaining
separately owned unsent operations/drafts for explicit reconciliation.

Retain changes for a default thirty-day window. A cursor below the retained floor returns a specific
reset-required response. Pruning advances the floor transactionally. Tombstones in cached state
prevent late responses during a session; full reset removes dependence on indefinite client
tombstone retention. Invalid, foreign-account, or foreign-deployment cursors are rejected.

### Centrifugo integration

Use a personal channel per authenticated account for durable-change wakeups. A wakeup contains only
the latest available cursor and schema version; it does not contain message bodies, sender names,
invitation secrets, or media URLs. Clients cannot publish business events or subscribe to another
account's channel. A worker can coalesce wakeups while preserving the highest committed cursor.
Out-of-order or duplicate wakeups are harmless; the client tracks the maximum and catches up from
PostgreSQL.

Use Centrifugo connect/refresh proxies to validate the same server-side session and assign personal
subscriptions. Proxy endpoints are internal and authenticated. Forward only explicitly allowed
transport headers; never trust a client-supplied user ID. Enforce Origin on the WebSocket handshake.
Revocation disconnects the affected connection/session and future refresh fails. Bound the maximum
refresh interval; transport disconnection is not the authorization boundary for business reads.

Centrifugo history is an optimization for transient disconnects. Always synchronize on reconnect, on
foreground return, and periodically while active so a lost final wakeup cannot leave a client stale
forever. Back off with jitter when realtime or sync is unavailable. Rebuilding Valkey requires no
reconstruction of business history.

Typing and presence are best-effort expiring state. The API checks membership and privacy, then
publishes transient notifications to authorized personal channels. Do not persist typing as durable
history or fan out presence changes to every channel subscriber. Restrict presence observation to
authorized contacts and actively viewed direct conversations. Losing these notifications must not
affect message correctness.

## 8. History, search, drafts, and frontend caching

History uses keyset pagination by conversation message sequence, never page-number offsets. Provide
before/after queries, a target-message neighborhood, a date anchor, pinned messages, and filtered
media history. All variants apply the same visibility predicate and retain grouping context at page
boundaries. Deleted/inaccessible targets return an unavailable result without leaking content.

Search supports a conversation or all the account's accessible conversations, sender, date range,
and content kind. PostgreSQL holds normalized plain text and indexes. The baseline behavior is
literal substring search, including Chinese, with escaped wildcard characters. Use `pg_trgm` where
the query can benefit, but do not promise that one/two-character terms use that index efficiently.
Short queries are restricted to one conversation, bounded by a date range and work budget; broader
search requires a longer term. No external search service or linguistic relevance engine is
required. Validate UTF-8 locale behavior and query plans with the actual Chinese/English corpus.
Search never returns hidden/deleted/expired text or unauthorized poll answers.

The frontend cache holds recent conversation summaries, bounded message pages, entity revisions, the
durable sync cursor, drafts, and pending operations. Set a cache budget and evict history pages;
virtualized DOM size alone is not a storage or memory budget. Do not persist presigned URLs as file
identity. Search and jump navigation fetch neighborhoods without loading the intervening history.

Draft text, rich text, emoji, and reply context synchronize per account/conversation using versions.
Local typing is persisted immediately and sent with debounce. A concurrent-device conflict does not
silently overwrite active text: retain the local version and offer the remote version to restore or
replace. A send includes the draft version it used; clear that server draft only if it still
matches. New text typed while a send is pending survives the send response. Forwarding and stickers
preserve unrelated drafts. Unfinished attachment previews remain device-local; uploads can be
abandoned.

Separate pending operations from canonical messages. Persist a send before attempting the network;
retry with its existing operation ID. A persistent media-send retry requires a finalized server file
or a locally persisted Blob; otherwise explain that the user must select the file again. Do not
claim reload-safe uploads merely because a temporary object URL exists.

Multiple tabs may use independent sessions/connections and idempotent commands; correctness must not
require electing one tab as leader. Coordinate IndexedDB writes and broadcast invalidations between
tabs. A shared cache writer must compare its expected checkpoint before committing so an older tab
cannot regress the durable cursor or overwrite newer projections. On conflict, reload the checkpoint
and merge/refetch. Draft conflicts remain explicit across tabs as well as devices.

Account-wide settings include notification policy, contacts, sticker selection/order, and per-chat
preferences. Device-local settings include appearance, wallpaper, font size, keyboard behavior,
autoplay, volume, and input/output devices. Keep these lifetimes explicit in settings UI.

## 9. Files, processing, and link previews

### Upload and finalization

Create an upload reservation through the API after quota and authorization checks. Assign an opaque
object key in a private staging area. The client receives short-lived S3 upload authorization and
uploads directly; use single-part upload for small objects and multipart for larger ones. Upload
completion is an authenticated, idempotent API command, not trust in the browser's success callback.

The API verifies object existence and declared size, then a worker validates file signatures and
media metadata within CPU, memory, time, dimension, and duration limits. Client MIME type and file
extension are hints. Generate image thumbnails, video posters and compatible playback derivatives,
and voice duration/waveform as needed. Keep the original for download. Include voice recording in
the frontend using a supported browser codec and normalize it to a supported playback derivative.
Use isolated FFmpeg/image processing with no network access and bounded subprocess resources.

Upload authorization remains reusable until expiry, so never attach the mutable staging key to a
message. Finalization copies the validated candidate into a server-only immutable key and validates
that immutable copy before making it ready. No client credential can overwrite final keys. Each
processing attempt uses a distinct candidate key; only the current fenced attempt can install its
result. Stale attempts may leave garbage but cannot replace an accepted file.

File states are reserved, uploaded, processing, ready, rejected, and deleting/deleted. A message can
reference only ready files owned by its sender or obtained through an authorized forward. The
composer displays upload/processing progress separately from message acceptance. Failure retains the
user's text and offers retry or replacement.

Initial quotas are 25 MiB per image, 100 MiB per document/video, and 1 GiB of retained original
uploads per account, with a separate deployment storage ceiling and derivative budget. Reserve quota
before issuing credentials, reconcile against verified size, and release abandoned reservations.
These limits are agreed adjustable defaults and need storage/bandwidth measurement.

### Reading and retention

Download/preview authorization is tied to an accessible message reference, an authorized avatar
reference, or an owned pending upload, not possession of a file ID. Avatar references inherit the
profile or conversation metadata visibility rules and never authorize unrelated uploads. Issue
short-lived signed GET URLs after checking current membership, personal hide/clear state, deletion,
and expiry. Browser playback uses Range requests where supported. Keep S3 buckets private and use a
separate media origin without application cookies. Serve active or unknown document types as
downloads, with safe content types and nosniff headers.

A signed URL is a bearer capability until it expires. Its default lifetime is one minute; membership
revocation prevents new URLs but cannot cancel an already issued URL or bytes already downloaded.
This bounded limitation is part of the target. Do not claim immediate revocation of object access.
If immediate revocation becomes required, replace direct downloads with an authenticated gateway.

Store references explicitly. Forwarding creates another reference to immutable bytes, so removing
one message cannot delete a surviving forwarded attachment. Charge retained originals to the
uploader until the last reference disappears; do not offer unrestricted public cross-user dedup. A
garbage-collection transaction locks the file, verifies no references/reservations remain, marks it
deleting, and prevents new references. Physical S3 deletion retries afterward. Use a grace period
for orphan candidates and abandoned multipart uploads; count variants in deployment capacity.

### Link previews

Generate URL previews asynchronously after message acceptance. Only fetch HTTP(S), block private,
loopback, link-local, and metadata addresses, validate each redirect and resolved destination, bound
response size/time, and isolate network egress. Defend against DNS rebinding; a hostname check alone
is insufficient. Strip active markup and copy eligible preview images through the same processing
pipeline. Failure leaves a normal clickable link. Do not fetch private/internal links. Edits and
deletions fence obsolete preview jobs so they cannot restore old content.

## 10. Notifications and administration

In-app notifications and optional Web Push obey server-side mute, block, read, and visibility state.
Store push subscriptions per session/device. Workers recheck eligibility immediately before sending,
collapse duplicate work by event/device identity, and remove expired subscriptions. Service workers
deduplicate by notification identity. Providers do not offer end-to-end exactly-once delivery, so
the UI must tolerate duplicates and late delivery.

Push is opt-in and defaults to a generic message without private body text. The click target loads
current authorized state. A message deleted after dispatch cannot be recalled from the push
provider. Active foreground clients suppress redundant local notifications. Push delivery is
best-effort and is never a read receipt or a substitute for synchronization. Browser/OS permission,
background execution, and push-provider availability limit delivery. No native-style guaranteed
incoming-call wakeup is promised for a closed or suspended browser.

Optional email requires configurable SMTP. With SMTP disabled, ordinary registration/login still
works; settings clearly disable email verification/recovery rather than pretending to send mail.
Development uses a local mail capture service. Support retries without exposing verification/reset
secrets in job inspection, metrics, or logs.

Provide a small administrator surface inside the existing frontend for registration policy, account
suspension, reports, conversation shutdown, storage quotas, and failed-job inspection/retry.
Bootstrap the first administrator using an operator command, never a default public password.
Privileged actions require recent authentication and append an audit record. Audit logs contain
actor, action, target, reason, and outcome, without credential or message-body dumps.

Account suspension is reversible: reject new login and all ordinary authenticated reads/writes,
revoke sessions and push subscriptions, disconnect realtime, and terminate owned calls. Reject new
direct messages or invitations to the suspended account. Preserve group memberships, shared content,
and account data; other members continue normally. Restoration requires a new login and bootstrap,
not revival of revoked sessions. Conversation shutdown is a reversible administrative quarantine:
remove discovery, reject joining and all ordinary member reads/writes/file authorization, emit
access-removal changes to members, and preserve membership/content for possible restoration. The
owner cannot bypass quarantine. Restoration emits directory/access changes and clients refetch.
Permanent deletion is a separate action with the deletion rules above. Signed media URLs and LiveKit
credentials retain their explicitly documented revocation limitations in both cases.

Reports reference content that the reporter could access and retain a restricted evidence snapshot
for moderator review even if the source is deleted. Default evidence retention is ninety days,
followed by removal unless an operator explicitly extends an active case. Explain this exception to
ordinary content deletion. There is no unrestricted private-message browsing interface for
administrators. Operators with database/storage access remain trusted under the cloud-chat model.

Rate-limit registration, password attempts, user discovery, new direct conversations, invitations,
uploads, and calls. Keep account bans and quotas in PostgreSQL. Valkey loss cannot remove a ban or
create unlimited upload quota. During rate-limit-store failure, sensitive public write endpoints
fail closed; authenticated reads and durable synchronization can continue with conservative local
concurrency limits. Exact limits are configuration, not hardcoded client assumptions.

## 11. One-to-one calls using LiveKit

Calls are a separate bounded module that depends on accounts, direct conversations, privacy, durable
sync, and notifications. No call media flows through Rust, Centrifugo, or object storage. Use the
official browser SDK and Rust server SDK; do not implement WebRTC transport in the application.

Persist call ID, direct conversation, initiator, recipient, media mode, state/reason, designated
sessions, timestamps, and a unique LiveKit room name. States are ringing, connecting, active, and
ended. End reasons distinguish rejected, cancelled, missed, busy, permission denied, transport
failure, and normal completion. Terminal state never transitions back to active.

Creating a call acquires per-account call slots in stable order, verifies contact/block policy, and
reserves both participants to prevent crossing calls. Ring the recipient's active devices. The first
valid acceptance atomically claims one recipient session; all other devices stop ringing. Caller
cancellation and recipient acceptance serialize on the call row. A rejected stale command returns
the current state. Only the designated initiating and accepting sessions receive room credentials.
Session identity within the room is fixed and cannot be freely supplied by a client.

Room credentials allow only the designated room and required microphone/camera tracks; they grant no
room creation/administration or data publishing beyond what is needed. Enforce a two-participant
room limit. Request camera permission when video is selected; adding video during a voice call
requires explicit user action and the other side's UI reflects that change. Muting, selecting
devices, and reconnecting are local media operations reflected in call UI.

Use short-lived initial join tokens, server-side room deletion on hangup, and an expiring reconnect
grace period. Validate signed LiveKit webhooks and deduplicate them. Out-of-order webhooks cannot
revive ended calls. Reconcile against the room service after uncertain webhook delivery and use
durable timeout jobs for unanswered calls, failed setup, and expired reconnect grace. Ending a call
releases call slots and adds one deduplicated service event to the direct chat.

Self-hosted LiveKit does not invalidate issued JWTs merely because a participant was removed.
Automatic SDK token refresh also means initial token TTL alone is not a revocation bound. Use a new
unguessable room name for every call, never reuse ended room names, stop issuing application tokens
after termination, disconnect/delete the room, and reject/clean any late participant in a terminal
room through webhook/reconciliation. A cached token may still permit transient access to that
obsolete room; it must never grant access to a later call. Do not promise instantaneous token
revocation. Measure and document refreshed-token behavior in the pinned self-hosted version before
accepting the call module. Stronger immediate admission revocation would require an additional
validated admission mechanism or a different deployment capability.

If LiveKit fails, messaging continues and the call ends with a recoverable error. If PostgreSQL is
unavailable, do not admit new calls or grant new credentials. Existing media may continue briefly
until disconnect/timeout; state is reconciled after recovery. Production requires reachable media
ports, public address configuration, TLS, and TURN coverage. Compose alone cannot establish these
network conditions. Test real cross-network calls, not only two tabs on one laptop.

## 12. Logical data model and transaction ownership

Use relational tables for identity, permissions, relationships, and independently concurrent state.
Use versioned JSONB for validated content payloads where appropriate, not for one giant workspace
snapshot. The following groups define ownership, not a mandatory table-per-line inventory:

- Accounts: users, credentials, verified/pending email, recovery challenges, sessions, contacts,
  blocks, account settings, and push subscriptions.
- Conversations: conversations, memberships/roles, bans, invitations, join requests, per-user list
  state, read cursors, personal message hides, and drafts.
- Messages: messages, immutable message-identity tombstones, media references, pins, reactions,
  polls/options/votes, checklist tasks, and typed service content.
- Media: upload reservations, immutable files, variants, references, processing attempts, and quota
  reservations/accounting.
- Delivery: per-user sync heads/change groups, operation receipts, durable jobs, and delivery
  attempts. Business history remains canonical; the change feed is a retained projection feed.
- Calls: calls, designated participants/sessions, per-account active call slots, and webhook
  receipts.
- Administration: reports/evidence, sanctions, registration policy, and append-only audit entries.

Important database constraints include normalized username uniqueness, one saved chat per account,
one direct chat per unordered pair, one membership per conversation/account, one message sequence
per conversation, message identity uniqueness, operation identity uniqueness per actor, and unique
reaction/vote/reference identities. Use foreign keys and checks where they express real invariants.
Ownership transfer must preserve exactly one owner without an observable ownerless interval.

Keep independent versions for message content, poll state, checklist structure/tasks, drafts,
membership/access, and personal conversation state. One giant revision would create false edit
conflicts whenever an unrelated reaction or read receipt changes.

Authorization-changing operations and writes to affected content share transaction locks. Media
reference attachment and garbage collection share the file-state lock. Expiration, deletion, and
interaction updates share the message/conversation coordination boundary. Workers never hold these
locks during network requests or media decoding.

## 13. HTTP and event contract

Use versioned JSON HTTP endpoints under `/api/v1`. OpenAPI is the source for client types and error
contracts. All paginated collections have explicit limits and opaque validated cursors. UUIDs are
strings; timestamps are UTC RFC 3339; counters are decimal strings. Clients localize presentation.

Resource families cover:

- Registration, login/logout, session listing/revocation, password/email/recovery, and account
  profile.
- User discovery, contacts, blocks, account privacy, preferences, and push subscriptions.
- Conversation discovery/creation, membership, roles, invitations, join requests, and personal
  state.
- Messages and history neighborhoods, edits/deletes/forwards, pins, reactions, polls, and
  checklists.
- Read cursors, drafts, media browsing, and permission-filtered search.
- Upload reservations/parts/completion/status, authorized file access, and asset catalogs.
- Bootstrap and incremental synchronization.
- Call create/accept/reject/cancel/end/current state and session-bound join credentials.
- Reports and authorized administration.

Commands take actor identity from the authenticated session. Reject client-supplied ownership,
roles, aggregate votes, authoritative timestamps, and sender names as authority. Return canonical
entities plus revisions and the actor's relevant change position. Receiving this response must not
advance the client's global sync cursor past unrelated unseen events; only ordered sync does that.

Errors have a stable machine code, English diagnostic message, request ID, and optional field
errors/retry guidance. Distinguish unauthenticated, forbidden/not found under disclosure policy,
validation, version conflict, idempotency conflict, quota, rate limit, reset required, and temporary
dependency failure. Do not expose raw SQL, tokens, file paths, or internal stack traces.

The durable event envelope includes schema version, event ID, account cursor/group identity,
resource identity, change kind, and revision. Client handling of unknown event versions triggers a
compatible refresh/upgrade path instead of silently advancing past unhandled changes. Callbacks from
Centrifugo and LiveKit use separate internal endpoints and verified service credentials.

## 14. Worker correctness and failure behavior

PostgreSQL is the durable queue. Claim bounded jobs with row locks and expiring leases. Each claim
has a fencing token; only its current owner can complete or update the job. A crashed worker leaves
work available after lease expiry. Retry transient failures with bounded exponential backoff and
jitter. Preserve exhausted jobs with an operator-visible reason and explicit retry capability.

Fencing a job row does not cancel an external side effect. Realtime publication is duplicate-safe;
email/push can be delivered more than once; object processing writes distinct immutable candidates;
call termination is idempotent. Record stable side-effect identities and recheck business state
before performing effects. Do not promise exactly-once external delivery.

Separate job classes and concurrency budgets so a large video cannot starve wakeups, call cleanup,
or notifications. Expiry/cleanup jobs use bounded batches. Poll deadlines, invitation expiry, file
access, and message expiry are also checked synchronously, so correctness does not wait for workers.
If the durable backlog exceeds a configured safe capacity, reject new affected writes before
exhausting PostgreSQL storage; keep reads and repair operations available where possible.

Expected degradation:

- PostgreSQL unavailable: reject authoritative reads/writes that cannot be safely served; retain
  unsent client operations. Never report success based on cache state.
- Valkey/Centrifugo unavailable: durable data remains safe; clients catch up by HTTP with backoff.
  Presence/typing are unavailable, and sensitive rate-limited writes may be restricted.
- Worker unavailable: accepted text messages remain queryable; realtime/media/notifications lag.
  Reads still enforce expiration and authorization.
- RustFS unavailable: text messaging continues; uploads and media downloads show retryable
  errors.
- SMTP or browser push unavailable: account login and chat continue; optional delivery is delayed.
- LiveKit unavailable: calls fail clearly while chat remains usable.

## 15. Deployment, operations, and recovery

Compose starts a reverse proxy/static frontend, API, Worker, PostgreSQL, Valkey, Centrifugo, and
RustFS for private S3. Include separate optional profiles for LiveKit/TURN,
development mail capture, and observability. Optional profiles do not imply those final-product
features are permanently omitted. Basic chat must start without SMTP or LiveKit configured.

RustFS persists objects and metadata together on its named volume. The local single-node setup
uses one data disk. Document the full data directory and the coordinated PostgreSQL backup in
the [runtime operations guide](../../operations.md#persistence-and-recovery).

Only the reverse proxy and required media/upload endpoints are publicly reachable. PostgreSQL,
Valkey, internal callbacks, and administration ports remain private. Credentials come from runtime
secrets/environment, with a checked-in example containing no real values. Pin image and dependency
versions; avoid floating latest tags. Distinguish internal S3 endpoints from browser-reachable
endpoints when signing requests, and test CORS and forwarded-host behavior.

Run schema migration as an explicit deployment step with a single migration lock. Use compatible
expand/contract changes where old and new binaries can overlap. Readiness checks verify required
dependencies for that process; liveness does not restart healthy API processes merely because an
optional mail service is down. Graceful shutdown stops new claims/requests and bounds in-flight
work.

Collect structured logs, request/trace IDs, API latency/errors, DB pool waits, worker backlog age,
failed jobs, sync lag/resets, WebSocket reconnects, storage/quota growth, media failures, and call
setup/termination failures. Exclude message bodies, password/email tokens, cookies, signed URLs, and
full contact information. Alert on lag and capacity, not merely whether containers are alive.

Recovery objectives for a small single-deployment installation are an RPO of one hour and an RTO of
four hours, subject to a measured restore drill. PostgreSQL and RustFS need off-host backups plus
retained secrets/configuration. A consistent backup procedure must coordinate business references
with object storage and pause destructive garbage collection during its capture. Keep backup
objects long enough to cover older retained database snapshots. Database PITR alone does not
establish recovery of media bytes. Restore into an isolated environment, verify message and file
references and permissions, rotate the deployment sync epoch, and force clients to bootstrap. Do not
use a database snapshot newer than the available object backup without a documented repair
procedure. Valkey is rebuilt rather than trusted as recovered business state.

## 16. Verification and final-product acceptance

This is a target verification strategy, not a report that any backend checks already pass.

Use focused unit tests for domain rules and real PostgreSQL integration tests for transactions,
authorization, concurrency, idempotency, and cursor ordering. Integration tests use real Valkey,
Centrifugo, and RustFS where their behavior matters. Browser tests cover complete user workflows
and existing editor/history behavior; mocks alone cannot validate transport and storage contracts.

Required acceptance scenarios:

1. Two independently registered users discover each other, exchange messages and private files,
   reply/edit/react, and see correct read state across two devices each.
2. A send commits but its HTTP response is lost; retry returns the same message, including after an
   application restart. Conflicting operation reuse is rejected.
3. A device is offline during edits/deletes/membership changes, reconnects, and converges. Repeat
   after change-feed retention expires and after Valkey is cleared.
4. Concurrent transactions allocate cursors without a committed update being skipped. A late history
   response and an older browser tab cannot resurrect a deletion or regress a checkpoint.
5. Joining/leaving/banning races with sends, search, downloads, and votes. Unauthorized reads fail,
   removed clients purge cached history, and signed-URL residual access matches its documented TTL.
6. Concurrent votes do not inflate voter counts, quiz secrets remain hidden, and checklist edits
   report meaningful conflicts. Deadlines hold while workers are stopped.
7. Public discovery and private invitations obey approval, revocation, use limits, ownership, and
   ban rules. Personal archive/hide/clear operations do not delete another account's data.
8. Upload retries, multipart interruption, processing failure, staging overwrite, and GC races never
   attach unvalidated bytes or delete still-referenced files. Forged MIME and hostile preview URLs
   fail safely within resource budgets.
9. Large histories support older-page loading, distant reply/search/date jumps, media browsing, and
   Chinese search without loading all messages or breaking reading anchors.
10. Concurrent drafts and a send followed by new typing preserve unsent text. Logout/account switch
    clears private caches and rejects stale asynchronous results.
11. Optional email recovery is verified and single-use; session revocation blocks new requests. Push
    handles revoked subscriptions, duplicates, mute, and read suppression without being used as a
    delivery/read guarantee.
12. One-to-one calls handle two-device acceptance, simultaneous cross-calls, cancel/accept races,
    permission denial, refresh/reconnect, late webhooks, and termination during session revocation.
    Test microphone/camera controls, real TURN fallback, and obsolete-room token behavior.
13. API and Worker restart independently; failed external effects retry; backlogs remain observable.
    A backup restore recovers authorized history and media, and clients reset safely afterward.
14. The agreed load scenarios are measured on documented hardware with bounded cache, DB, worker,
    and media resources. Report observed latency/capacity instead of claiming unmeasured scale.

Target current desktop Chrome, Firefox, Safari, and Edge for core chat. Verify responsive touch use
and voice/media handling on real iOS Safari and Android Chrome. Browser push and background calling
have capability-dependent behavior that must be explained in UI. Existing Chromium-only tests are
not evidence of those broader guarantees.

Run formatting, linting, type checks, focused tests, migrations against a clean database and an
upgrade fixture, integration tests, and relevant browser workflows before accepting implementation.
Tests must validate behavior and failure recovery, not assert that a particular new file exists.

## 17. Implementation roadmap and remaining discretion

The [implementation milestones](../plans/2026-11-08-product-milestones.md) derive delivery order and
acceptance gates from this approved design. This document owns product semantics; the roadmap owns
implementation sequence. Neither document claims that planned capabilities already exist.

The builder may choose compatible dependency versions, concrete SQL/index layouts, DTO field names,
bounded retry schedules, thumbnail sizes, Rust module filenames, and test tooling without changing
the stated semantics. Record choices where they become executable configuration or code. Measure and
tune operational limits; changing user-visible permission/history semantics requires revisiting this
design.

The approved defaults include authenticated-only public discovery, full retained history for
admitted members, immutable usernames, contacts-only incoming calls by default, forwarding/deletion
semantics, no self-service recovery without a verified email, device-local appearance, signed-URL
revocation limits, capacity/quota assumptions, and backup objectives.

## 18. Primary references

These references support integration constraints, not a claim that the target is implemented.

- [Axum](https://docs.rs/axum/latest/axum/) and [SQLx](https://docs.rs/sqlx/latest/sqlx/) describe
  the selected HTTP/runtime and SQL integration foundations.
- [RustCrypto Argon2](https://docs.rs/argon2/latest/argon2/) documents the selected password-hash
  library.
- [Centrifugo recovery](https://centrifugal.dev/docs/server/history_and_recovery) describes bounded
  broker recovery; the application still owns durable catch-up.
- [Centrifugo engines](https://centrifugal.dev/docs/server/engines) documents Valkey-compatible
  broker operation. Validate the exact selected versions in integration tests.
- [Centrifugo proxies](https://centrifugal.dev/docs/server/proxy) documents backend-controlled
  connections, refresh, subscriptions, and explicitly forwarded transport headers.
- [Centrifugo consumers](https://centrifugal.dev/docs/server/consumers) documents async publication
  options. This design deliberately uses the shared Rust Worker for business jobs and wakeups rather
  than making the application's sync protocol depend on Centrifugo's outbox schema.
- The [RustFS S3 compatibility matrix](https://docs.rustfs.com/en/reference/s3-compatibility)
  lists supported operations. Verify presigning, CORS, Range, copies, and cleanup against the
  pinned deployment.
- [PostgreSQL pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html) documents
  substring-index behavior and the limitations of patterns that yield no usable trigrams.
- [LiveKit Rust SDKs](https://github.com/livekit/rust-sdks) provide server-side API integration.
- [LiveKit token grants](https://docs.livekit.io/frontends/reference/tokens-grants/) explain room
  permissions, automatic refresh, and the self-hosted token-revocation limitation.
- [LiveKit deployment](https://docs.livekit.io/transport/self-hosting/deployment/) describes the
  public address, TLS, media-port, and TURN requirements beyond ordinary HTTP deployment.
- [Browser Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) describes service
  worker delivery and browser-managed push subscriptions.
