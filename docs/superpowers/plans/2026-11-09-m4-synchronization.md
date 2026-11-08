# M4 synchronization and message lifecycle

> **Execution:** Use `superpowers:executing-plans` inline, with one independent final review.

**Goal:** Deliver the approved M4: durable realtime catch-up, multiple-device correctness, and
ordinary message lifecycle operations for direct and Saved conversations.

**Spec:** [Complete product design](../specs/2026-11-08-complete-product-design.md), sections 5–8
and 14. [Milestone contract](2026-11-08-product-milestones.md#m4-realtime-multiple-devices-and-message-lifecycle).

**Architecture:** PostgreSQL remains authoritative. Conversation locks serialize lifecycle writes;
ordered account and sync-head locks preserve admission and commit order. Separate content,
interaction, draft, and access revisions prevent unrelated conflicts. Worker publication carries
only wakeups; HTTP sync supplies authorized projections. IndexedDB transactions couple cached state
and checkpoints, with compare-and-set across tabs. Pending sends remain separately owned.

**Technology:** Existing Rust/Axum/SQLx, PostgreSQL, Valkey, Centrifugo, React, IndexedDB, and Compose.
Use maintained HTTP/realtime clients instead of implementing their protocols.

## Global constraints

- Work on the current checkout and branch. Group local Conventional Commits by responsibility; do
  not push. Preserve existing files outside this milestone.
- Follow global readability requirements, including semantic blank lines, explanatory English
  comments, descriptive identifiers, named options, bounded nesting/chains, and native formatters.
- Preserve M3 acceptance identity, continuous history windows, foreground position, and pending-send
  race protections. No business transaction may call an external service.
- All commands carry stable operation IDs. Replay matching commands without reapplying effects;
  reject mismatched payloads. Keep permanent message identity after deletion.
- Read authorization excludes hidden, cleared, expired, and inaccessible bodies immediately.
  Feed removals and observation cursors fence stale history, including after reset.
- Test observable boundaries, races, and failure recovery; avoid implementation-shaped tests.
- M5 communities, M6 media/search/forwarding, and later calls remain outside M4.

## Review focus

Review lock ordering and rollback under competing send/close/read/edit operations; stale operation
replay after deletion; quote privacy after hide/clear/expiry; content versus interaction revisions;
expired content before cleanup; lease fencing when publication succeeds but acknowledgement fails;
proxy header trust and revoked sessions; cache checkpoint CAS and quota aborts; full reset and old
history responses; two tabs drafting and send followed by typing; bounded history continuity and
foreground read boundaries. Check real runtime wiring, not only isolated service tests.

### Task 1: Authorized lifecycle transactions and projections

**Files:** `migrations/`, `src/messages/`, `src/conversations/`, `src/sync/`, `tests/messages.rs`,
`tests/sync.rs`, new `tests/message_lifecycle.rs`.

**Produces:** Versioned edit/delete/hide/reaction/pin/reply/expiry behavior; operation receipts;
visibility-aware message/history projections and explicit sync removals.

1. Write failing real PostgreSQL behavior tests for author permissions, edit conflicts, operation
   replay, independent reaction versions, hidden/deleted/expired reads, and reply scrubbing.
2. Add lifecycle storage and a common command transaction boundary. Keep content tombstones and
   permanent identity distinct; never retain deleted private excerpts in feed payloads.
3. Extend history with bounded target neighborhoods and snapshot observation metadata. Add typed
   expiry service notices; filter expiry synchronously before cleanup.
4. Run `cargo test --test message_lifecycle -- --include-ignored` with the isolated database.
   Expected: all lifecycle authorization and concurrency assertions pass.
5. Run Rust formatting and compile checks; commit as `feat(messages): add authorized message lifecycle`.

### Task 2: Personal state, synchronized drafts, and read cursors

**Files:** `src/conversations/`, `src/messages/`, `src/sync/`, `tests/conversation_state.rs`.

**Consumes:** Task 1 command receipts, authorization, and revisions.
**Produces:** Versioned drafts, conditional send clearing, monotonic reads, preferences, hide/clear/
close, reopening admission, accurate unread repair, and peer read projections.

1. Write failing tests for conflicting drafts, typing after send, monotonic reads, clear/hide unread
   exclusion, and close/reopen capacity without losing the clear cutoff.
2. Implement account-owned desired-state commands and draft compare-and-set. Sending captures an
   optional expected draft version; unrelated/newer drafts survive acceptance.
3. Extend bootstrap/sync projections and command HTTP/OpenAPI contracts.
4. Run `cargo test --test conversation_state -- --include-ignored`.
   Expected: personal state and race cases pass; regenerate API types without drift.
5. Commit as `feat(conversations): synchronize drafts and personal state`.

### Task 3: Durable jobs, retention, and authenticated realtime

**Files:** `src/jobs/`, new `src/realtime/`, runtime/config, deployment, operator commands,
`tests/jobs.rs`, new realtime tests, runtime verification scripts.

**Consumes:** Tasks 1–2 transactional wakeups and lifecycle projections.
**Produces:** Coalesced fenced wakeup jobs, bounded retries and operator retry, expiry cleanup and
feed retention, authenticated connect/refresh proxies, session disconnects.

1. Verify current Centrifugo protocol against official documentation and installed runtime.
2. Write failing tests for newer wakeups during a lease, expired lease owners, exhaustion/retry,
   cursor pruning, proxy secret/origin/session checks, and invalid subscriptions.
3. Implement independent Worker budgets with timeouts, jitter, fencing, and sanitized diagnostics.
   Connect/refresh assigns only the authenticated account's personal channel and bounded expiry.
4. Run `cargo test -- --include-ignored` against isolated PG/Valkey/SMTP and real Centrifugo checks.
   Expected: all backend tests pass and unauthorized/revoked realtime access fails.
5. Commit jobs and realtime integration separately by responsibility.

### Task 4: Atomic bounded client cache and realtime catch-up

**Files:** `web/src/features/chat/data/`, account ownership integration, package manifests.

**Consumes:** Tasks 1–3 observation cursors, removals, access revisions, and realtime contract.
**Produces:** Atomic IndexedDB cache/checkpoints, tab CAS/reload, reset fencing, quota-safe fallback,
reconnect/focus/periodic catch-up, bounded canonical cache.

1. Write failing IndexedDB/owner tests for stale writers, transaction failure, deletion followed by
   stale history, full resets, account switching, duplicate/out-of-order wakeups, and eviction.
2. Implement durable cache transactions and serialized application. Broadcast invalidations after
   commit, compare expected checkpoints, and refetch on conflict. Preserve unsent operations.
3. Connect the maintained Centrifugo client; keep periodic HTTP recovery when realtime fails.
4. Run `pnpm --dir web test` and `pnpm --dir web build`.
   Expected: existing M3 history/pending behavior and new failure cases pass.
5. Commit as `feat(sync): persist atomic cache checkpoints across tabs`.

### Task 5: Connected lifecycle and draft interactions

**Files:** Connected chat, composer/timeline integration, message models and behavioral tests.

**Consumes:** Tasks 1–4 canonical commands and synchronized state.
**Produces:** Usable edit/delete/hide/reply/jump/pin/reaction/read controls, personal preferences,
expiry notices, conflict-aware drafts, and honest retry/conflict UI.

1. Write failing owner/UI tests for conflicting drafts and edits, conditional clearing, foreground
   reached-message read updates, unavailable reply targets, and late command responses.
2. Wire connected controls to stable operations. Preserve selection/reading position and new typing;
   expose remote drafts without silently replacing active text.
3. Run `pnpm --dir web test` and `pnpm --dir web build`.
   Expected: connected workflows pass alongside existing editor/timeline tests.
4. Commit state ownership and connected UI separately if their responsibilities warrant it.

### Task 6: Multi-session runtime acceptance and documentation

**Files:** `web/e2e-accounts/`, `scripts/`, `docs/messaging.md`, development/runtime docs and roadmap.

**Consumes:** Integrated Tasks 1–5.
**Produces:** Repeatable four-session convergence and recovery verification, current usage docs.

1. Add browser/runtime acceptance for two accounts with four sessions and shared-cache tabs;
   interleave edits/deletes/reads, reset a retained cursor, restart Worker, clear Valkey, and interrupt
   Centrifugo. Assert convergence and no resurrection, preserving reply navigation/reading position.
2. Run complete Rust, frontend unit, formatting, Clippy, API drift, demo/connected browser suites,
   and isolated Compose acceptance. Expected: all checks pass; report any material limits honestly.
3. Update owning documentation and milestone checkboxes only for behavior actually verified.
4. Commit tests/runtime and documentation by responsibility.

### Task 7: Independent whole-change review and final verification

**Files:** Only justified fixes and their behavioral regressions.

**Consumes:** Complete milestone diff, spec, plan, and execution ledger.
**Produces:** Reviewed, verified local commits and a clean checkout.

1. Dispatch one fresh-context whole-change reviewer with the baseline, HEAD, review focus, and ledger.
2. Regrade findings by user effect; fix important defects with failing regressions first. Record
   decisions and limitations; do not dispatch repeated reviewers.
3. Run all applicable final checks. Expected: green checks and clean grouped local commits.
4. Remove this plan's execution scratch and task-owned runtime resources; report the result in Chinese.
