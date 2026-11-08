# M3 Durable Direct Messaging Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline in the existing checkout and
> branch. The owner authorized M3 and grouped commits. Do not repeat product approval or create
> a worktree. Use one independent whole-change review after implementation.

**Goal:** Two real accounts exchange rich text through the existing editor and timeline, recover
history after restart, and retry an ambiguous send without creating a duplicate message.

**Architecture:** PostgreSQL transactions own direct/Saved uniqueness, message identities,
permission/capacity checks, receipts, personal change groups, and coalesced wakeup intent. HTTP
bootstrap/sync/history expose bounded authorized snapshots. A separate connected frontend owner
persists pending sends before submission and supplies bounded pages to the existing renderers.

**Tech Stack:** Existing Rust/Axum/SQLx/Tokio/Utoipa, library HTML parsing/sanitization, React/Lexical,
TanStack Virtual, IndexedDB, generated OpenAPI, Vitest/Playwright, PostgreSQL and Docker Compose.

**Spec:** [Approved product design](../specs/2026-11-08-complete-product-design.md), sections 2,
4-8, 12-16; [M3 milestone](./2026-11-08-product-milestones.md#m3-first-durable-direct-message-flow).

**Status:** Implemented and locally verified on 2026-11-09. The independent whole-change review
identified four frontend ownership races; failing regressions were added and fixed. The final
continuous-window audit additionally covers old sync backlog, sequence jumps, and predecessor context.
Current design and repeatable verification live in [durable messaging](../../messaging.md).

## Global constraints

- Keep root Rust ownership and the existing branch. Commit each tested responsibility separately.
- Follow English code/docs/comments, 100 columns, semantic blank lines, purpose comments on public
  functions, bounded nesting/chains, named option inputs, and multiline literals. Use Rustfmt and
  existing Prettier. Libraries should own protocol parsing and generic persistence work.
- One canonical direct conversation per unordered user pair and one Saved conversation per account.
  The first accepted direct message creates both directory memberships atomically. Directory
  capacity is 200 entries plus Saved, including hidden/archived entries; reject recipient exhaustion
  without exposing counts. Settings rows hold archive/mute/pin/read/clear fields for later commands.
- Every send has a client message UUID and operation UUID. Bind identities to the actor forever;
  store receipts with the transaction. Matching canonical payload replays, mismatched reuse conflicts.
  Retain receipts at least seven days; M3 does not prune them. Never call external services in a send
  transaction. Client timestamps do not order accepted messages.
- Numeric counters travel as decimal strings. Allocate conversation sequence and per-account feed
  position transactionally. Lock one conversation, participant accounts in UUID order, then sync
  heads in UUID order; use bounded retries for PostgreSQL deadlock/serialization errors. Defer new
  conversation's participant foreign-key checks until commit to avoid early key-share lock inversion.
- Blocks, suspension, direct-message audience, and both participants' capacity are authoritative.
  Recipient contacts mean the recipient saved the sender. Saved is private and does not consume a
  general directory slot. Existing direct chats bypass initial capacity checks, never block checks.
- Bootstrap uses one repeatable-read snapshot for private account/contact/privacy state, directory,
  and cursor, excluding message history. Sync groups are atomic pages with current authorized entity
  materialization and an observation cursor. Cursors bind deployment and account. History uses
  before/after sequence keysets; unknown and unauthorized IDs have the same unavailable result.
- Wakeup intent is one row per account containing its highest committed feed cursor. The Worker
  leaves it pending while realtime is disabled; M4 owns publication and authenticated transport.
- Initial content policy: schema version 1; 4,096 UTF-16 text units; 64 KiB HTML; depth 32; 2,048
  parsed nodes; 100 custom emoji; 20 table rows/columns; 100 cell spans; 2,048 formula UTF-16 units.
  These are builder-selected bounded defaults. Independently sanitize supported semantic markup,
  derive canonical text and emoji ranges, reject mismatched input, and permit only bundled emoji IDs.
- Share rich-content fixtures between Rust and browser tests. Canonical block separators are single
  newlines, table cells use tabs, and terminal structural newlines are removed. The connected adapter
  derives this transport representation from editor HTML without changing demo/Lexical behavior.
- Initial API pages: history 50/max 100, sync 50/max 100 complete groups. Connected memory holds at
  most 200 messages for the selected conversation, with explicit latest/older navigation. Pending
  sends are separately bounded at 100 and namespaced by deployment/account/session. No demo import.
- Initial live adapter polls every three seconds while visible, catches up on focus/online, and
  backs off on failure. Persist before sending, retain operation identity across retry/reload, and
  stop automatic retries after seven days. Logout/revocation clears pending ownership; stale work
  cannot recreate it. M4 owns durable canonical-cache checkpoints and draft conflict synchronization.
- M3 supports text/rich text/custom emoji and private Saved. Attachment/media sending, edit/delete,
  reactions, read advancement, replies, group/channel membership, and realtime remain later work.
  Hide or disable unavailable controls; accepted means stored by the server, never delivered/read.

## Review focus

1. Two initial sends or reciprocal sends race with blocks, suspension, and capacity; no orphan
   conversation membership, partial feed, or lock inversion may survive rejection.
2. A send commits but its HTTP response disappears, including across API restart; retry must return
   the same message. Receipt expiry must never make a prior message UUID reusable.
3. A transaction stalls after allocating a feed position; another commit must not let clients skip
   it. Bootstrap directory and cursor must share the same snapshot.
4. Rich-text tables/lists/formulas/dates and astral emoji must preserve canonical text and UTF-16
   offsets while removing executable markup and untrusted asset identities.
5. Logout, view changes, reload, quota errors, or delayed network results must not lose an accepted
   send, transfer private content, duplicate an optimistic row, or load unbounded history.

## Task 1: Versioned rich-content contract

**Files:** `src/messages/content.rs`, `src/messages/mod.rs`, `src/lib.rs`, Cargo dependencies,
`contracts/message-content.json`, `tests/message_content.rs`,
`web/src/features/chat/data/messageContent.ts` and its tests, and Docker contract build inputs.

**Interfaces:** `MessageContent { schema_version, text, rich_text, custom_emoji }`;
`validate_content(MessageContent) -> Result<MessageContent, AccountError>`;
frontend `canonicalMessageContent(EmojiText)` returns the generated-compatible transport shape.

- [x] Add shared fixtures for plain/astral text, lists, tables, quotes/spoilers, formula/date markup,
      unsafe attributes/scripts/URLs, and bundled custom emoji; assert text/range parity and rejection
      of mismatched ranges, unsupported versions, nesting, table, formula, and size limits.
- [x] Run focused Rust/frontend tests first; expect missing interfaces, then implement library-owned
      sanitization/HTML parsing with explicit attribute and resource bounds. No hand-written tokenizer.
- [x] Verify `cargo test --test message_content`, focused frontend fixtures, Rustfmt/Clippy, and
      frontend type checking. Commit the transport contract separately.

## Task 2: Atomic direct/Saved send and durable identities

**Files:** `migrations/202611090001_messaging.sql`, `src/conversations/`, `src/messages/service.rs`,
`src/messages/model.rs`, `src/sync/changes.rs`, `src/accounts/sessions.rs`, `tests/messages.rs`.

**Interfaces:** `MessageService::new(AccountService)`;
`send(Actor, SendMessage { operation_id, message_id, destination, content }) -> SendReceipt`;
`Destination` selects recipient, existing conversation, or Saved; `ensure_saved(Actor)` is idempotent.
DTOs include canonical message identity/sequence/version/time/author and personal conversation state.

- [x] Write real-PG tests for duplicate/reciprocal first sends, Saved privacy, matching replay,
      conflicting operation/message identities, contact-only/nobody/block/suspension rejection, capacity
      races, and complete rollback of message/membership/feed/receipt/wakeup effects.
- [x] Observe failures, then implement migration and bounded transaction retry. Lock the conversation
      before ordered participant rows; recheck actor/session and recipient policy under those locks.
      Keep permanent message identity records separate from prunable operation receipts.
- [x] Commit sequence, summaries/unread, receipt, one grouped feed position per participant, and
      coalesced wakeup intent together. Saved stays in its reserved slot; existing direct memberships
      retain access to old history when new sends are blocked.
- [x] Verify `cargo test --test messages -- --include-ignored` with real PG; all previous Rust tests,
      Rustfmt/Clippy must remain green. Commit this transaction boundary.

## Task 3: Authorized snapshot reads and HTTP contracts

**Files:** `src/sync/mod.rs`, `src/sync/cursor.rs`, `src/messages/history.rs`,
`src/messages/http.rs`, root API/runtime wiring, generated contracts, `tests/sync.rs`,
`tests/messaging_http.rs`.

**Interfaces:** `bootstrap(Actor) -> Bootstrap`; `sync(Actor, SyncQuery) -> SyncPage`;
`history(Actor, HistoryQuery) -> HistoryPage`; `message(Actor, Uuid) -> CanonicalMessage`.
Routes: `GET /api/v1/chat/bootstrap`, `GET /api/v1/chat/sync`,
`POST /api/v1/messages`, `GET /api/v1/messages/{message_id}`,
`GET /api/v1/conversations/{conversation_id}/history`. Use existing cookie/CSRF/Origin boundaries.

- [x] Add tests for snapshot consistency, stalled feed allocation, bounded complete-group paging,
      foreign/malformed/future cursors, history keysets, missing/unauthorized IDs, and exact HTTP replay.
- [x] Observe failures; implement repeatable-read materialization and deployment/account-bound
      cursors. Include grouping context in history without loading intervening history. Keep response
      schemas decimal-counter safe and requests bounded; expose messaging capability and limits.
- [x] Verify sync/HTTP suites with real PG/Valkey, regenerate OpenAPI/TypeScript, and run contract
      drift checks. Commit public messaging APIs independently.

## Task 4: Connected message ownership and durable pending sends

**Files:** `web/src/features/chat/data/ChatOwner.ts`, `pendingMessages.ts`, `messageModels.ts`,
focused colocated tests, and necessary IndexedDB library dependency.

**Interfaces:** `ChatOwner` owns bootstrap, serialized catch-up, current bounded history, account/view
generations, and observable snapshots. `queueSend` persists its stable message/operation identity
before HTTP. Pending-store transactions check session ownership before every write or removal.

- [x] Write behavior tests for storage failure before submission, lost response retry, accepted/pending
      reconciliation, reload recovery, seven-day retry expiry, owner invalidation, late view results,
      monotonic projection merging, and the 200-message/100-pending budgets.
- [x] Observe failures, then implement pending storage and canonical models separately. Poll/catch-up
      serially, fence ownership at asynchronous boundaries, and show queued/sending/accepted/failed
      accurately. Preserve new draft edits when an earlier send finishes.
- [x] Verify focused tests, all frontend units, type checking/build, and commit the connected owner.

## Task 5: Existing composer/timeline integration

**Files:** `web/src/features/chat/connected/ConnectedChat.tsx`, styles and hooks;
existing `MessageComposer`, `MessageTimeline`, `useHistoryWindow`, `useVirtualHistory`,
`MessageBubble`/`MessageMetadata`, account workspace/contacts entry, and identity context.

**Interfaces:** Connected chat uses authenticated identity and `ChatOwner`, reuses Lexical composer
and virtual history, opens discovered recipients or Saved, and preserves stable message UUID keys.
Optional component inputs retain unchanged demo defaults; remote history loads through an explicit
page source. Unavailable actions never dispatch into demo reducers.

- [x] Add tests for real identity alignment, honest acceptance statuses, disabled unsupported
      attachment/actions, retained composer edits, and remote history page triggers/grouping.
- [x] Observe failures; implement connected directory/chat routes within the authenticated workspace,
      responsive navigation, older/latest paging, pending retry/discard feedback, and account settings
      return. Do not mount `useChatState` or fixed-user demo storage.
- [x] Verify frontend units/build and existing demo browser suite; inspect desktop/mobile connected
      layouts. Commit UI integration separately.

## Task 6: Fault acceptance, documentation, and completion

**Files:** `web/e2e-accounts/direct-messaging.spec.ts`, `scripts/check-runtime.mjs`, fault harness,
backend/frontend topic docs, CI settings, milestone/implementation status.

- [x] Add real two-user browser flows for first send, rich content, reload/restart recovery, Saved,
      unauthorized access, older paging, and pending reload. Drop a real HTTP response after the real
      PostgreSQL commit, restart API, and replay the same operation; assert exactly one message and
      complete recipient change visibility. Do not replace this with mocked dispatch success.
- [x] Run all real-service Rust suites, Rustfmt/Clippy, generated-contract drift, frontend
      formatting/unit/build, demo and connected browsers, and complete isolated Compose acceptance.
- [x] Run one independent whole-change review, re-grade findings by user impact, and fix required
      issues with failing regressions before the final green run. No per-task implementation agents.
- [x] Document implemented guarantees, limits, pending/retry policy, storage cleanup, and M4 boundary;
      mark only observed completion. Remove task-owned resources and scratch, preserve grouped local
      commits, and do not push or begin M4.
