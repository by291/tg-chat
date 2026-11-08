# Durable direct messaging

Connected messaging uses PostgreSQL as its authority. The API accepts text, supported semantic HTML,
and bundled custom emoji for direct conversations and private Saved Messages. The existing editor
and virtual timeline render those records. The explicit demo retains its independent local behavior.

## Acceptance and ownership

A direct conversation has one canonical unordered participant pair. The first accepted message
creates both directory memberships in the same transaction. Each account has a separate reserved Saved
conversation; its general directory admits up to 200 conversations, including hidden or archived
entries. An existing membership bypasses initial capacity admission, never recipient policy checks.

The sender supplies a message UUID and operation UUID. Canonical validated content and destination
are hashed with those identities. A matching retry returns the original message, sequence, timestamp,
and current personal conversation projection. Mismatched reuse conflicts. Permanent identity bindings
are separate from operation receipts, so receipt cleanup cannot make a message identity reusable.
Receipts are not pruned in M3; future cleanup must retain them for at least seven days.

Acceptance locks one conversation, then its participant accounts in UUID order, then the personal
sync heads in UUID order. New conversation participant foreign keys are deferred until commit to avoid
acquiring account key-share locks before the intended account write locks. Deadlock and serialization
failures have a bounded transaction retry. Session revocation, account suspension, recipient audience,
directional contacts, blocks, and both directory capacities are checked under the corresponding locks.
A later block prevents new sends but does not prevent reconciling an already accepted send or reading
previously authorized history.

The transaction stores the message, conversation summary and sequence, incoming unread counts,
operation receipt, personal change groups, and coalesced wakeup intent together. PostgreSQL counters
are allocated by updating locked rows, not independent sequences; an earlier uncommitted group cannot
be skipped by observing a later commit. All counters cross HTTP as decimal strings.

## Snapshot reads

`GET /api/v1/chat/bootstrap` returns the private account, privacy, bounded contacts/blocks, directory,
deployment identity, and cursor from one repeatable-read snapshot. It ensures the reserved Saved entry
exists before opening that snapshot. It never includes history.

`GET /api/v1/chat/sync` consumes a deployment/account-bound cursor and returns complete committed
change groups, materialized current authorized entities, and the snapshot's observation cursor. Pages
never split a transaction group. Malformed, foreign, pruned, and future cursors require a new bootstrap.
There are no message deletion commands in M3; later lifecycle work must add authorized removal/tombstone
projections before pruning entities referenced by retained change groups.

`GET /api/v1/conversations/{conversation_id}/history` uses before/after sequence keysets and returns
one preceding message as sender-group context. `GET /api/v1/messages/{message_id}` reconciles one
message. Both hide unknown and foreign resources behind the same not-found result. History and sync
pages default to 50 and permit at most 100 items/groups. Account cookies, CSRF, Origin enforcement,
request markers, no-store responses, and sanitized errors also protect messaging routes. Send admission
uses a separate authenticated rate limit from credential operations.

## Content contract

The versioned policy in `contracts/message-policy.json` and shared fixtures define supported semantic
markup, resource bounds, canonical block/table separators, and UTF-16 custom-emoji ranges. The browser
adapts Lexical's representation; the server independently parses, sanitizes, derives canonical text,
and rejects mismatched text or asset ranges. Ammonia and scraper own HTML parsing and cleaning.
Custom emoji may reference only the bundled public catalog. Client timestamps never order acceptance.

## Browser durability and recovery

The connected owner keeps canonical history in memory and persists pending operations and drafts in
IndexedDB, keyed by deployment/account/session. Submission starts only after the pending transaction
commits. A captured draft revision is cleared only if no newer edit replaced it. Pending operations
retain their original IDs and content across network errors and reloads. At most 100 pending sends and
201 drafts are retained for a session.

The active conversation holds at most 200 accepted messages. Older/latest navigation selects a bounded
window while TanStack Virtual independently bounds mounted rows. Delayed pages are fenced by view
generation; an older request retains its left edge, and a bounded in-flight buffer retains sync
arrivals while a latest snapshot is being fetched; delayed private requests are fenced by session generation. Authoritative versions merge
without floating-point conversion. Queued, sending, server-accepted, and failed states are distinct;
server acceptance does not claim delivery or reading by the recipient.

Visible pages poll every three seconds, catch up on focus/online, and back off on errors. Automatic
retries stop after seven days. Explicit Retry grants one attempt using the original identity and age;
it does not restart the automatic retry window. Unconfirmed sends remain inspectable; removing one from the outbox does
not delete a message that may already have committed. Logout/revocation clears owned pending/draft
content and leaves a storage tombstone that rejects stale writers. Reload preserves pending work.

M4 owns authenticated Centrifugo delivery, durable canonical cache/checkpoint coordination, draft
conflict synchronization, read advancement, and message lifecycle commands. M3's Worker deliberately
leaves one coalesced wakeup row per account pending; it does not pretend to publish realtime events.
Attachments, reactions, edits, deletion, replies, and groups remain unavailable in connected mode.

## Verification

Real PostgreSQL tests cover concurrent first sends, policy/capacity rejection, complete rollback,
permanent identity reuse, snapshot cursors, and stalled feed allocation. Browser tests cover two-account
rich messaging, pending reload, keyset history, authenticated alignment, mobile layout, and Saved
privacy. `scripts/check-messaging.mjs`, invoked by the isolated Compose acceptance runner, forwards a
real send, consumes the committed API response, drops the client socket, restarts API, and replays the
same operation. It verifies one stored message and one complete recipient change group.
See [development](./development.md) for repeatable commands and environment requirements.
