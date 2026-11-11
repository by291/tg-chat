# M8 Notifications, Moderation, and Account Lifecycle Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement this plan task by task. Track progress with checkboxes.

**Goal:** Deliver connected notifications, report review, reversible restrictions, and account
deletion for controlled messaging acceptance.

**Architecture:** PostgreSQL owns durable policies, cases, audit, and dispatch work. Extend the
existing authorization, sync, Worker, and RustFS paths. Use Valkey for expiring activity and the
browser service worker for optional Push.

**Tech Stack:** Axum, SQLx, PostgreSQL, Valkey, Centrifugo, RustFS, React, IndexedDB, Web Push,
and Playwright. Use a maintained library for Web Push encryption and VAPID signing.

**Spec:** [Approved M8 design][spec], [product design][product], and [milestone gate][roadmap].

## Global constraints

- Work in the current checkout. Commit each task separately using the stated Conventional
  Commit. Append migrations after M7. Preserve existing replay identities and API defaults.
- Follow [AGENTS.md](../../../AGENTS.md). Separate preparation, validation, mutation, and
  publication with logical blank lines. Give public functions a one-line English purpose
  comment. Place English reasons beside complex branches and decisions that depend on
  authorization, ordering, concurrency, idempotency, or recovery. Apply Rustfmt and Prettier,
  the 100-character limit, and the repository limits on nesting, chains, and parameters.
- Reuse the established lock order for conversations, accounts, sessions, messages, and files.
  Order repeated locks by ID, recheck authorization under the required locks, and allocate
  sync positions last. Open external connections after committing database work.
- Regenerate OpenAPI and frontend types with `pnpm --dir web api:generate` in the task that
  changes the contract. Keep counters as decimal strings. Keep demo and device-local state
  separate from connected account state.
- Run ignored PostgreSQL, Valkey, and RustFS tests against disposable services. Use deterministic
  delivery fixtures in default verification. Keep real provider and browser/OS coverage explicit.

## Responsibility and order

| Task | Ownership | Depends on |
| --- | --- | --- |
| 1. Operator authority | Recent authentication, audit, registration and suspension | M2–M7 |
| 2. Report evidence | Cases, original retention, restricted access, and collection | 1 |
| 3. Operator workspace | Quarantine, quotas, exhausted jobs, and connected screens | 1–2 |
| 4. Account deletion | Terminal identity, ownership, private cleanup, and UI | 1–3 |
| 5. Account settings | Versioned preferences and private settings refresh | 4 |
| 6. Activity | Session foreground leases, direct presence and typing | 4–5 |
| 7. Notifications | In-app alerts, subscriptions, dispatch, and service worker | 5–6 |
| 8. Acceptance | Connected browsers, real services, and owning documentation | 1–7 |

Keep operator HTTP, cases, and quarantine under `src/moderation/`. Account mutations belong in
`src/accounts/`, object retention in `src/media/`, and dispatch in `src/notifications/`.
Shared modules own route and runtime wiring. Each task can be reviewed independently.

## Review focus

- Operator authorization expires while waiting for the target lock. Reject the action before
  changing the target or recording a success (Task 1).
- A report races removal of the final ordinary file reference. Commit complete evidence or
  reject the report. Keep derivative collection independent (Task 2).
- A client misses quarantine and sees only restoration. The new generation invalidates its
  old cached pages (Task 3).
- Community creation or transfer races deletion. Every live community keeps an eligible
  owner, and username reuse preserves old account links and attribution (Task 4).
- A user reads the message or revokes the session after a push job is claimed. Recheck before
  dispatch and leave read state untouched (Task 7).

## Task 1: Operator authority and account restrictions

**Files:** Create `src/moderation/{mod,http}.rs`, `tests/moderation.rs`, and
`migrations/202611120007_operator_actor.sql`. Extend
`src/accounts/{operator,sessions,service,email}.rs`, `src/conversations/access.rs`,
`src/http.rs`, and `tests/operators.rs`.

**Interfaces:** `authorize_operator(connection, actor, settings)` returns an
`AuthorizedOperator` or `AccountError` under the existing recent-authentication window.
`POST /api/v1/operator/commands` accepts `OperatorCommand` with an operation ID, reason, and
typed action. Start with `set_registration` and `set_suspension`. `AuditEvent` carries actor
origin, target, action, reason, and outcome.

- [ ] Add `operator_action_rechecks_authority_after_target_wait`. Hold the target lock until
  the operator session expires or loses authority. Assert the target and success audit are
  unchanged. Add `suspended_account_needs_new_login_after_restoration` for new login, an old
  cookie, credential challenges, direct sends, and invitations. Verify CLI audit parity
  and one success audit across a browser command replay.
- [ ] Run `cargo test --locked --test operators --test moderation -- --include-ignored`.
  Confirm the new operator paths fail before implementation.
- [ ] Extend the append-only audit schema. Route CLI and browser actions to shared mutations.
  Lock any required conversation before the ordered actor and target account rows, then
  lock the actor session. Recheck authority and recent password authentication after lock
  waits. Bind operation identity to actor and payload, and reject changed-payload collisions.
- [ ] Under the account lock, suspend by revoking sessions and invalidating challenges. Reuse
  realtime disconnect and existing admission checks. Preserve membership and shared history.
  Require fresh login after restoration. Task 7 connects push detachment.
- [ ] Regenerate contracts and rerun operator, account, recovery, contact, and realtime tests.
- [ ] Commit `feat(moderation): authorize and audit operator account actions`.

## Task 2: Report cases and original-only evidence

**Files:** Create `src/moderation/{reports,evidence}.rs`,
`migrations/202611120008_report_evidence.sql`, and
`web/src/features/chat/connected/ReportMessageDialog.tsx`. Extend
`src/media/{references,cleanup,storage}.rs`, message projections, Worker maintenance,
the connected message menu, and `tests/moderation.rs`.

**Interfaces:** `POST /api/v1/messages/{message_id}/reports` accepts `ReportMessage` with
`operation_id`, `reason` (`spam`, `harassment`, `harmful_content`, or `other`), and an
optional note. `ReportReceipt` returns the case ID and evidence deadline. Case list and
detail use `/api/v1/operator/cases`.
Original downloads use `GET /api/v1/operator/cases/{case_id}/attachments/{occurrence_id}`.
Extend `OperatorCommand` with `resolve_case` and `extend_evidence`.

- [ ] Add `reported_original_survives_source_deletion_without_variants`. Report a message
  with media, delete it, and run real collection. Assert case download returns the original
  bytes. Verify the unneeded derivative objects are collected and neither unrelated attachments
  nor an ordinary send can obtain access through the case hold.
- [ ] Add `report_and_source_removal_resolve_under_the_same_file_locks` and
  `expired_case_releases_only_its_own_references`. Cover hidden, expired, and quarantined
  sources, cross-case occurrence denial, replay preserving the 90-day deadline, an audited
  extension, and immediate read denial at expiry. Assert a second live reference preserves
  the original and expiry of the final reference makes it collectible.
- [ ] Run `cargo test --locked --test moderation --test media -- --include-ignored`
  with RustFS. Confirm the case and retention behavior fails before implementation.
- [ ] Reuse current history visibility under source and ordered file locks. Snapshot the
  accepted message revision and permitted content. Derive ordered original occurrences from
  that message, including a forward's own occurrences. Recheck expiry against the current
  database clock after lock waits. Commit case, evidence, and receipt together. Bound the
  note at 500 UTF-16 units and reports at 10 per account per hour. Give duplicates the
  original deadline.
- [ ] Add an original-only retention query separate from ordinary upload reuse and
  authorization. Claim and mark collecting objects under the existing file lock. Allow
  independent derivative cleanup and retry failed physical deletion. Keep the original
  charged under existing quota rules until collection completes.
- [ ] Apply current operator authority, recent authentication, case identity, and expiry to
  every evidence read. Audit before opening a private download with no-store and nosniff.
  Bound already-open streams through expiry. Use database time for the default 90-day
  deadline and release expired case holds in bounded Worker batches. An audited extension
  requires an active, unexpired case and a later deadline at most 90 days from extension.
- [ ] Connect the report dialog and explain evidence retention after source deletion.
  Regenerate contracts and rerun moderation, media, and forwarding tests.
- [ ] Commit `feat(moderation): retain case-scoped original evidence`.

## Task 3: Quarantine and operator workflows

**Files:** Create `src/moderation/{quarantine,quotas,jobs}.rs`,
`migrations/202611120009_operator_quotas.sql`, and
`web/src/features/operator/OperatorWorkspace.tsx`. Extend conversation access and discovery,
`src/sync/{changes,snapshots}.rs`, `src/media/{uploads,downloads}.rs`, job repositories,
`web/src/features/accounts/AccountWorkspace.tsx`, `ChatOwner.ts`, and `tests/moderation.rs`.

**Interfaces:** Extend `OperatorCommand` with `set_quarantine`, `set_account_storage_limit`,
and `retry_job`. A direct chat resolves through a case ID. Groups and channels use a bounded
operator directory. Job projections carry kind, identity, status, attempts, time, and a safe
failure code. Retry targets a stable job identity.

- [ ] Add `restoration_invalidates_a_page_that_missed_quarantine`. Exercise discovery, joins,
  history, search, commands, and new media signatures while isolated, including for the
  owner. Verify ordinary retention and memberships survive restoration and the old cached
  generation cannot restore access.
- [ ] Add `direct_quarantine_requires_its_accepted_case` and
  `quota_and_job_actions_recheck_current_state`. Check mismatched case IDs, limit changes
  racing a reservation, safe job fields, and one eligible retry across repeated commands.
- [ ] Run `cargo test --locked --test moderation --test sync --test media -- --include-ignored`.
  Confirm the new operator actions fail before implementation.
- [ ] Set quarantine under the conversation lock. Advance membership generations and append
  personal sync changes on both transitions. Use those generations to invalidate client
  pages, search hits, and late reads. Preserve existing signed URL expiry.
- [ ] Store per-account storage limits and use the existing reservation lock for limit
  changes. Display deployment capacity and keep existing reservations valid. Support explicit
  retries for exhausted mail, sync wakeup, and media jobs when their payload and lease rules
  permit replay. Extend the job view with Push in Task 7.
- [ ] Wire report review and original downloads, registration, suspension, quarantine, quotas,
  and exhausted jobs into one operator workspace. Reuse reauthentication. Case disposition
  records review separately from ordinary author and community message removal.
- [ ] Regenerate contracts and rerun moderation, sync, search, jobs, and media tests.
- [ ] Commit `feat(moderation): connect the audited operator workspace`.

## Task 4: Terminal account deletion

**Files:** Create `src/accounts/lifecycle.rs`, `src/jobs/account_cleanup.rs`,
`migrations/202611120010_account_deletion.sql`, and `tests/account_lifecycle.rs`.
Extend account HTTP, sessions, credentials, email, directory, community creation and ownership,
message projections, Worker runtime, the connected security panel, and the session owner.

**Interfaces:** `POST /api/v1/account/deletion` accepts an operation ID and explicit confirmation
under recent authentication. Return an `AccountDeletionReceipt` or a typed ownership conflict
with the caller's owned communities. Key the durable cleanup job by account ID. Once the
session is revoked, a repeated HTTP request follows normal unauthenticated handling.

- [ ] Add `deletion_and_ownership_changes_cannot_orphan_a_community`. Race deletion against
  transfer and creation. Verify an ownership conflict leaves the account and its sessions usable.
- [ ] Add `deleted_identity_releases_username_without_relinking_shared_history`. Check old
  cookies, reset challenges, direct sends, rosters, invite admission, and account links.
  Register the same username with a new ID. Verify old history, tombstone presentation,
  restart-safe cleanup, released membership capacity, and preserved live case evidence.
- [ ] Run `cargo test --locked --test account_lifecycle -- --include-ignored`. Confirm the
  ownership and terminal-state cases fail for the missing deletion path.
- [ ] Fence ownership acquisition and deletion with the same account locks. Commit the
  tombstone, username release, credential and session invalidation, and cleanup intent together.
  Immediately exclude deleted accounts from auth, roster counts, directory, and new direct
  sends. Keep the peer's shared history readable and publish invalidation to affected readers.
- [ ] Retire invitations, relationships, private drafts, Saved Messages, personal settings,
  and avatar/private file references in restart-safe batches. Keep shared message and evidence
  references on their own lifetimes. Task 7 connects subscription detachment to revocation.
- [ ] Connect explicit confirmation, ownership conflicts, and private browser state cleanup
  to the real deletion path. Reconcile an ambiguous result through the existing session
  refresh. Regenerate contracts and rerun account lifecycle, recovery, contacts, conversations,
  sync, and media tests.
- [ ] Commit `feat(accounts): delete accounts without orphaning shared history`.

## Task 5: Account-wide preferences and settings refresh

**Files:** Create `src/accounts/preferences.rs`, `tests/account_preferences.rs`, and
`migrations/202611120011_account_preferences.sql`. Extend profile, privacy, and email mutations,
`src/sync/snapshots.rs`, `SessionOwner.ts`, and the connected notification and sticker settings.

**Interfaces:** `GET /api/v1/account/preferences` returns `AccountPreferences` with a decimal
version, notification defaults, and ordered bundled sticker IDs.
`PATCH /api/v1/account/preferences` accepts `expected_version` and changed fields.
Bootstrap and sync return `account_settings_version` for the authenticated account.

- [ ] Add `settings_refresh_across_sessions_without_overwriting_local_device_preferences`.
  Cover competing writes, stale responses, sticker order, and profile, privacy, and verified
  email changes. Assert the revision triggers owner-only refresh and no private data enters
  another account's sync or public projection.
- [ ] Run `cargo test --locked --test account_preferences --test recovery -- --include-ignored`.
  Confirm refresh is missing. Run the focused SessionOwner and settings tests.
- [ ] Validate bundled sticker IDs against the catalog. Store preferences with an expected
  version. Advance the settings revision transactionally on preferences, profile, privacy,
  and verified email changes. Use existing foreground and periodic sync to carry the revision
  even without chat traffic. Read settings through the owner-only account endpoints.
  Register preference cleanup with Task 4's terminal cleanup.
- [ ] Bind connected settings responses to the current session and newest revision.
  Keep appearance, keyboard, playback, and device choices local. Reuse the existing
  synchronized contacts and per-chat preferences. Supply notification defaults to Task 7.
- [ ] Regenerate contracts and rerun account preferences, recovery, SessionOwner, and
  notification policy tests.
- [ ] Commit `feat(accounts): synchronize connected account preferences`.

## Task 6: Foreground activity, presence, and typing

**Files:** Create `src/realtime/{activity,activity_http}.rs` and `tests/activity.rs`.
Extend `src/realtime/{client,proxy}.rs`, connected chat, composer, and session ownership.

**Interfaces:** `POST /api/v1/activity/heartbeat` refreshes the authenticated session's
foreground lease with a tab ID and optional active direct conversation ID.
`Activity::is_foreground(session_id)` supplies Task 7 with a best-effort foreground check.
Add `GET /api/v1/activity/presence/{user_id}` for a single authorized contact or active direct
peer and `POST /api/v1/conversations/{conversation_id}/typing` for typing or stop.
Publish expiring hints over existing personal channels.

- [ ] Add `activity_expires_and_is_fenced_by_current_audience_and_membership`. Check both
  block directions, audience changes, authorized contacts, active direct peers, tab races,
  late events, expiry, session revocation, and Valkey loss. Verify durable chat still works.
- [ ] Run `cargo test --locked --test activity -- --include-ignored` with PostgreSQL and
  Valkey. Confirm the missing activity behavior fails.
- [ ] Refresh a foreground lease every 15 seconds and expire it after 45 seconds. Use a
  6-second typing lease with throttled refresh. Keep one tab's stop from clearing another
  tab's current activity. Apply current conversation access and audience checks before
  observations and hints. Use transient hints to refetch current authorized activity.
  Keep leases and typing state in Valkey outside the durable message feed.
- [ ] Fence client updates by session and view generation. Let indicators expire after a
  missed stop. Degrade to unknown when the activity service is unavailable.
- [ ] Regenerate contracts and rerun activity, realtime, and connected chat tests.
- [ ] Commit `feat(realtime): add bounded direct chat activity`.

## Task 7: Connected alerts and optional Web Push

**Files:** Create `src/notifications/{mod,http,delivery}.rs`, `tests/notifications.rs`,
`migrations/202611120012_notifications.sql`, and
`web/src/features/settings/notifications/notificationWorker.ts`. Extend message acceptance,
`src/sync/{changes,snapshots}.rs`, Worker runtime, session revocation, operator jobs, connected
startup and settings, and deployment configuration.

**Interfaces:** `GET /api/v1/notifications/capability` returns availability and the public
VAPID key when configured. `PUT /api/v1/notifications/subscription` and
`DELETE /api/v1/notifications/subscription` manage one current subscription for the
authenticated session. `NotificationIdentity` binds message and subscription IDs.
Accepted new-message events have an additive sync marker.

- [ ] Add `claimed_push_is_suppressed_after_read_mute_or_session_revocation`. Hold dispatch
  after claim, then apply read, mute, block, quarantine, expiry, or revocation. Assert the
  transport is skipped and read state is unchanged. Verify a foreground session suppresses
  its own Push while an eligible background session still receives delivery.
- [ ] Add `ambiguous_delivery_reuses_notification_identity_and_retires_invalid_endpoints`.
  Check provider rejection, generic payload, endpoint policy, absent capability, and stable
  retry identity. In the frontend, cover duplicate alerts, reconnect backfill, stale session
  state, and a notification click whose target is inaccessible.
- [ ] Run `cargo test --locked --test notifications -- --include-ignored` and the focused
  notification tests. Confirm the delivery and suppression cases fail before implementation.
- [ ] Record one notification intent in the transaction that accepts a new message, including
  a forward. Use bounded fanout and leased per-subscription deliveries. Exclude self, Saved
  Messages, edits, and interaction changes. Recheck visibility, membership, settings, block,
  mute, read, subscription, and Task 6 foreground state immediately before dispatch.
  Start with a five-minute delivery lifetime and expire stale attempts.
- [ ] Detach subscriptions on logout, revocation, suspension, or deletion. Clean up expired
  sessions and invalid endpoints. Restrict outgoing requests to configured public HTTPS
  providers, validate and pin connection destinations, and disable redirects. Keep private
  VAPID material Worker-only and endpoint credentials out of logs and job projections.
- [ ] Feed active connected clients from authorized sync and establish a baseline on
  reconnect or cache rebuild. Bundle the service worker for the connected origin. Deduplicate
  generic alerts by notification identity scoped to deployment and subscription. Resolve clicks
  with normal authorized navigation and inbox fallback. Clear the old browser subscription
  mapping on account switch. Add opt-in, permission denial, and disabled capability states,
  plus safe exhausted-job retry.
- [ ] Regenerate contracts and rerun notification, message acceptance, sync, session, and
  frontend notification tests. Verify registration of the service worker in the built app.
- [ ] Commit `feat(notifications): deliver connected alerts and optional web push`.

## Task 8: Connected acceptance and handoff

**Files:** Add `web/e2e-accounts/administration.spec.ts`,
`web/e2e-accounts/notifications.spec.ts`, and `web/playwright.lifecycle.config.ts`.
Extend `scripts/check-runtime.mjs`, the Playwright suite scripts and exclusions,
`docs/{accounts,communities,development,media,messaging,operations}.md`, and the [roadmap].

- [ ] Add connected Chromium coverage for reporting, original download after source deletion,
  operator reauthentication, quarantine and restoration across browsers, and account deletion
  before and after resolving an ownership conflict. Reuse existing account and media fixtures.
- [ ] Add connected settings and activity convergence, foreground alert, service worker
  deduplication, and authorized click tests. Verify chat with email and Push disabled.
  Exercise real provider delivery separately when a configured provider and browser are
  available, and record the environment that actually ran.
- [ ] Run the commands below. The Compose runner must exercise real PostgreSQL, Valkey, and
  RustFS, the existing M6 reopen and M7 connected suites, and the new M8 suite.

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --all-targets
pnpm --dir web api:check
pnpm --dir web format:check
pnpm --dir web test
pnpm --dir web build
pnpm --dir web test:browser
node scripts/check-runtime.mjs
```

- [ ] Confirm successful exit from every command and verify the M6 reopen case sends only
  missing parts under the original message identity, with one recipient message. Run the
  standalone build and demo browser suite sequentially because they share `web/dist`.
  Review the milestone diff against the design and AGENTS.md. Resolve findings and rerun
  affected checks.
- [ ] Commit `test(messaging): verify connected M8 workflows`.
- [ ] Update owning documentation and mark the roadmap after the exit gate passes. Record the
  real Push/browser coverage at handoff. Commit
  `docs(messaging): describe notifications and account moderation`.

[spec]: ../specs/2026-11-12-m8-notifications-moderation-lifecycle-design.md
[product]: ../specs/2026-11-08-complete-product-design.md
[roadmap]: 2026-11-08-product-milestones.md#m8-notifications-moderation-and-account-lifecycle
