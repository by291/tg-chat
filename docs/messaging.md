# Durable messaging

Connected messaging uses PostgreSQL as its authority. The API accepts text, supported semantic HTML,
and bundled custom emoji for direct conversations, private Saved Messages, groups, and channels.
[Community authorization](./communities.md) extends membership, publication, and moderation rules. The existing editor
and virtual timeline render those records. The explicit demo retains its independent local behavior.

## Acceptance and ownership

A direct conversation has one canonical unordered participant pair. The first accepted message
creates both directory memberships in the same transaction. Each account has a separate reserved
Saved conversation; its general directory admits up to 200 conversations, including hidden or
archived entries. An existing membership bypasses initial capacity admission, never recipient policy
checks.

The sender supplies a message UUID and operation UUID. Canonical validated content and destination
are hashed with those identities. A matching retry returns the original message, sequence,
timestamp, and current personal conversation projection. Mismatched reuse conflicts. Permanent
identity bindings are separate from operation receipts, so receipt cleanup cannot make a message
identity reusable. The Worker retains command receipts for seven days; permanent send identities
survive cleanup.

Acceptance locks one conversation, then its participant accounts in UUID order, then the personal
sync heads in UUID order. New conversation participant foreign keys are deferred until commit to
avoid acquiring account key-share locks before the intended account write locks. Deadlock and
serialization failures have a bounded transaction retry. Session revocation, account suspension,
recipient audience, directional contacts, blocks, and both directory capacities are checked under
the corresponding locks. A later block prevents new sends but does not prevent reconciling an
already accepted send or reading previously authorized history.

The transaction stores the message, conversation summary and sequence, incoming unread counts,
operation receipt, personal change groups, and coalesced wakeup intent together. PostgreSQL counters
are allocated by updating locked rows, not independent sequences; an earlier uncommitted group
cannot be skipped by observing a later commit. All counters cross HTTP as decimal strings.

## Snapshot reads

`GET /api/v1/chat/bootstrap` returns the private account, privacy, bounded contacts/blocks,
directory, deployment identity, and cursor from one repeatable-read snapshot. It ensures the
reserved Saved entry exists before opening that snapshot. It never includes history.

`GET /api/v1/chat/sync` consumes a deployment/account-bound cursor and returns complete committed
change groups, materialized current authorized entities, and the snapshot's observation cursor.
Pages never split a transaction group. Malformed, foreign, pruned, and future cursors require a new
bootstrap. Groups contain explicit message removals and nullable conversation projections. Personal
hiding, clearing, closing, deletion, and expiry remove unauthorized bodies from current projections.
The Worker prunes only a contiguous old feed prefix, advancing its retention floor in the same
transaction.

`GET /api/v1/conversations/{conversation_id}/history` uses before/after sequence keysets and returns
one preceding message as sender-group context. `around` loads a bounded authorized reply
neighborhood; `pinned=true` provides a separate paginated pin directory. Both preserve personal
visibility. `GET /api/v1/messages/{message_id}` reconciles one message. Both hide unknown and
foreign resources behind the same not-found result. History and sync pages default to 50 and permit
at most 100 items/groups. Account cookies, CSRF, Origin enforcement, request markers, no-store
responses, and sanitized errors also protect messaging routes. Send admission uses a separate
authenticated rate limit from credential operations.

## Content contract

The versioned policy in `contracts/message-policy.json` and shared fixtures define supported
semantic markup, resource bounds, canonical block/table separators, and UTF-16 custom-emoji ranges.
The browser adapts Lexical's representation; the server independently parses, sanitizes, derives
canonical text, and rejects mismatched text or asset ranges. Ammonia and scraper own HTML parsing
and cleaning. Custom emoji may reference only the bundled public catalog. Client timestamps never
order acceptance.

## Browser durability and recovery

The connected owner persists canonical projections and their cursor atomically in IndexedDB, keyed
by deployment/account/session. An epoch plus cursor compare-and-set prevents an old tab from
regressing shared state. Each tab separately tracks the feed consumed by its visible window:
adopting another tab's durable checkpoint cannot skip changes to a window no longer in the shared
page cache. Quota failure aborts the entire update. Bootstrap resets replace the canonical epoch;
pending sends, uncertain commands, and local drafts remain separately owned. Submission starts only
after the pending transaction commits, even if remote draft synchronization is offline. Before its
first transport attempt, the owner durably freezes the wire payload and any matching server draft
revision. A captured local revision is cleared only if no newer edit replaced it. Pending operations
retain their original IDs and content across network errors and reloads. At most 100 pending sends
and 201 drafts are retained for a session.

The active conversation holds at most 200 accepted messages. Older/latest navigation selects a
bounded window while TanStack Virtual independently bounds mounted rows. Delayed pages are fenced by
view generation and observation cursor; an older request retains its left edge, and a bounded
in-flight buffer retains sync arrivals while a latest snapshot is being fetched; delayed private
requests are fenced by session generation. Content and interaction versions merge independently
without floating-point conversion. Destructive changes invalidate old pages and scrub reply
excerpts. Command acknowledgements commit invalidation fences before being removed from the retry
queue; they never advance the feed cursor. History cache writes merge overlapping content and
interaction revisions independently. The durable page cache has a separate byte/page budget;
eviction never moves the sync cursor backward. Bounded removal fences prevent resurrection even when
the removed row was already evicted. Queued, sending, server-accepted, and failed states are
distinct; server acceptance does not claim delivery. Read receipts advance only through an actually
reached message in a focused visible timeline, and the peer cursor controls the read indicator.

Authenticated Centrifugo publications wake the HTTP catch-up loop. Visible pages also poll, catch up
on focus/online, and back off with jitter on errors. A lost notification cannot skip durable
changes. Automatic retries stop after seven days. Explicit Retry grants one attempt using the
original identity and age; it does not restart the automatic retry window. Unconfirmed sends remain
inspectable; removing one from the outbox does not delete a message that may already have committed.
Logout/revocation clears owned pending/draft content and leaves a storage tombstone that rejects
stale writers. Reload preserves pending work.

## Lifecycle and personal state

`POST /api/v1/chat/commands` accepts stable operation IDs and desired-state actions. Replays
validate the payload before returning a current authorized projection. Shared effects use the same
conversation-first lock order as acceptance; personal effects append only the owner's feed group.
Content edits require the author and expected content version. Conflicts return the authorized
current message while the editor retains its text. Reactions have a separate revision, an allowlist,
and a per-account limit. Pins and reactions are shared; hiding a message is personal. Deletion
preserves identity, removes content and interactions, and invalidates old reply excerpts.

Drafts use a separate compare-and-set revision. Debounced saves retain local input during network
failure and expose competing drafts for an explicit choice. Two tabs that save a stale local
revision retain bounded alternatives. Reply-source visibility and quote validity are independent of
the draft text revision: edits, hides, clears, deletion, and expiry scrub active and recovered
excerpts while preserving local text. Sending captures both its local draft identity and the
matching server revision; neither acknowledgement may erase later typing. Ambiguous commands are
persisted before transport and remain explicitly retryable using the same ID. Commands older than
receipt retention require reconciliation rather than blind replay.

Archive, mute, directory pin, manual unread, hidden state, and keep-archived preference belong to
the account. Each preference command names only its changed field, so a device toggling archive
cannot overwrite a concurrent mute or pin choice. Clear advances its visibility cutoff; close also
deactivates membership. Reopening preserves the cutoff and repeats directory capacity admission. A
new incoming message unhides a conversation; archive retention follows mute and keep-archived
preference. Read cursors only advance.

Expiry policies apply to future messages and create typed service notices. Reads and commands
exclude expired bodies immediately, before the bounded cleanup worker tombstones them. Authorized
directory summaries, message replies, and draft replies include their source deadlines. Browser
timers remove expired projections even after switching conversations, while offline, or while
cleanup is unavailable; the pin directory also observes its own deadlines. Reply targets must be
visible in the same conversation; an unavailable target retains only its unavailable identity, never
its former quoted content. Attachments, forwarding, search, groups, and channels remain later work.

## Realtime and maintenance

Centrifugo authenticates connect/refresh through private API callbacks. The callback verifies its
shared secret, configured browser Origin, and the ordinary session cookie; it assigns only the
account's server-side personal subscription. Client publication and arbitrary subscription are
forbidden. The Worker checks registered connections against session revocation/expiry/suspension and
issues disconnects; refresh repeats authorization.

Publications contain only a schema version and cursor. The durable coalesced wakeup row is claimed
with a lease token, published outside the business transaction, and acknowledged only by its current
owner. A newer position survives an older publication acknowledgement. Bounded attempts and backoff
lead to an inspectable exhausted state; an admission budget prevents unbounded wakeup growth and
rolls back the entire business transaction if no new row can be admitted. Publication, retention,
expiry, disconnection, and email work have independent bounded loops. See
[operations](./operations.md) for retry commands and configuration.

## Verification

Real PostgreSQL tests exercise concurrent acceptance and edits, policy/capacity rollback, permanent
identity reuse, content/interaction revisions, private quotes and summaries, expiry before cleanup,
draft conflicts, conditional clearing, monotonic reads, feed retention, publication leases, and
backlog admission. Browser unit tests inject stale pages, cross-tab checkpoint races, quota failure,
reset, ambiguous acknowledgements, and typing during draft saves.

`pnpm --dir web test:accounts` covers account isolation, SMTP recovery, rich messaging, pending
reload, history paging, and mobile Saved Messages. `pnpm --dir web test:sync` uses two accounts,
four sessions, and an extra shared-cache tab to exercise edits, reactions, pins, replies, deletion,
and full reset. Run the suites with independent admission fixtures: they intentionally preserve
production rate limits. The isolated Compose runner owns that separation and additionally interrupts
Worker/Centrifugo, clears Valkey, advances a fixture's retention age, and verifies durable recovery.
See [development](./development.md) for prerequisites and repeatable commands. These are correctness
gates, not a production load or long-duration availability certification.
