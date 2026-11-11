# TG Chat Product Milestones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement a selected milestone task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking. This document defines milestone scope and acceptance; expand only
> the selected milestone into its detailed execution plan before changing product code.

**Goal:** Deliver the approved small public chat product in independently verifiable increments,
including a separately delivered LiveKit calling module.

**Architecture:** One Rust project at the repository root provides API and Worker processes sharing
business modules and PostgreSQL transactions. The existing React frontend integrates incrementally
through HTTP commands and durable synchronization; Centrifugo supplies wakeups, RustFS stores
private media, and LiveKit transports call media.

**Tech Stack:** Rust, Tokio, Axum, SQLx, PostgreSQL, Valkey, RustFS S3, Centrifugo, LiveKit,
React, TypeScript, pnpm, Docker Compose, OpenAPI, Rustfmt, Clippy, and the existing
Prettier/Vitest/Playwright toolchain. Pin compatible versions when each integration is introduced.

**Spec:** [Approved complete product design](../specs/2026-11-08-complete-product-design.md).

**Status:** Product design approved on 2026-11-08. M1 through M7 are implemented and locally
verified through isolated Compose. M6 passed the desktop Chromium exit gate. Physical mobile
recording and playback checks are outstanding. M8 through M10 remain planned.

## Global constraints

- Work in the current checkout and branch unless the owner requests isolation. Rust lives at the
  root; keep `web/` and do not introduce a `backend/` or `server/` wrapper directory.
- The approved design owns behavior. This roadmap changes delivery order, not product scope.
- Registration uses username/password; verified email is optional for recovery. No message E2EE.
- Public discovery requires authentication; admitted members can read retained pre-join history.
- One-to-one voice/video uses LiveKit. Group calls, screen sharing, and recording remain excluded.
- Every authoritative mutation is authenticated, authorized, bounded, and transactionally idempotent
  when its behavior requires a receipt. Realtime is never the sole copy of accepted data.
- Directory capacity is 200 entries plus Saved; contacts are limited to 1,000, groups to 200
  members, channels to 500 subscribers, and simultaneous one-to-one calls to 10 per deployment by
  default.
- General operation receipts cover seven days; durable change retention defaults to thirty days.
- Initial media limits are 25 MiB per image, 100 MiB per document/video, and 1 GiB of retained
  original uploads per account. Signed downloads default to one minute.
- Recovery targets are RPO one hour and RTO four hours, established by a measured restore drill.
- Use existing frontend formatting/tooling and Rustfmt/Clippy for Rust. Code, comments,
  documentation, logs, and commit messages use English; commits use Conventional Commits.
- Respect the repository's readability, naming, nesting, parameter, and 100-character formatting
  requirements. Tests cover behavior, boundaries, races, and failure recovery rather than file
  shape.
- Keep demo data explicitly separate. Backend mode must never display a mock success for a feature
  whose authoritative implementation is not available.
- Each milestone includes the frontend integration, migration, observability, and checks required
  for its usable outcome. Those concerns are not deferred wholesale to the final milestone.

## Review focus

These cross-cutting cases are explicitly assigned below so they cannot fall between subsystem plans:

1. A success response disappears after commit: reuse the original operation identity and produce one
   canonical message, including after restart. Owned by M3.
2. A stale tab/page response arrives after deletion or account switch: never resurrect content or
   regress the shared cache checkpoint. Owned by M4.
3. A join, removal, or first direct send races against capacity and permissions: enforce limits and
   access atomically without revealing another account's counts. Owned by M5, building on M3.
4. An upload is overwritten or garbage collection races with forwarding: publish only validated
   immutable bytes and preserve every live reference. Owned by M6 and extended by M7.
5. An old call token or delayed webhook arrives after hangup: never revive a terminal call or grant
   access to a later room. Owned by M9.

## Delivery order and release boundaries

The recommended order is M1 through M10. This is a dependency-based roadmap, not a calendar
estimate. Measure actual progress after the first complete messaging flow before estimating dates.

| Milestone | Usable outcome                                                   | Depends on |
| --------- | ---------------------------------------------------------------- | ---------- |
| M1        | Reproducible root Rust runtime and integration environment       | None       |
| M2        | Real accounts, sessions, contacts, and optional recovery         | M1         |
| M3        | Two users exchange durable direct messages in the frontend       | M2         |
| M4        | Realtime, multi-device convergence, and reliable message actions | M3         |
| M5        | Public/private groups and channels with enforceable membership   | M4         |
| M6        | Private media uploads, playback, recording, and cleanup          | M5         |
| M7        | Full search, forwarding, polls, and collaborative checklists     | M6         |
| M8        | Notifications, administration, and account lifecycle             | M7         |
| M9        | Independent one-to-one voice/video calling module                | M8         |
| M10       | Measured release readiness and recovery                          | M9         |

M3 is the first real two-user messaging demonstration. M4 is the first durable multi-device chat
baseline. M8 is a feature-complete messaging candidate without calls, suitable for controlled
acceptance. M9 completes planned product features. M10 is the public-release gate, not optional
cleanup. Do not expose an intermediate environment to unrestricted public registration simply
because the registration UI works.

M6's storage work can technically begin after M4, but its authorization acceptance requires M5. Some
M8 notification work can begin after M4, but moderation must cover the M5-M7 resource types. M9
follows the user's requested separation; do not let early call work delay reliable messaging. These
observations permit later scheduling choices and do not authorize parallel implementation now.

## Responsibility and file map

Create files when their owning milestone needs them; do not scaffold every future module in M1. The
paths below anchor detailed plans. A module can split by responsibility when its implementation
requires it; this is not a required identical directory template for every feature.

- M1 creates root `Cargo.toml`, `Cargo.lock`, `src/lib.rs`, `src/bin/api.rs`, `src/bin/worker.rs`,
  `src/config.rs`, `src/http.rs`, `src/database.rs`, `compose.yaml`, `.env.example`,
  deployment assets under `deploy/`, and `.github/workflows/backend.yml`.
- M2 owns `src/accounts/`, `src/contacts/`, the first durable mail jobs under `src/jobs/`,
  authentication/session middleware, and new frontend account routes under `web/src/features/auth/`.
  Reuse `web/src/features/settings/devices/DevicesSettingsPage.tsx` and
  `web/src/features/settings/profile/SettingsAccountDetails.tsx` for real account behavior.
- M3 owns `src/conversations/`, `src/messages/`, `src/sync/`, and extends the durable jobs under
  `src/jobs/`. Add frontend HTTP/generated contracts under `web/src/api/` and account-scoped cache
  ownership under `web/src/features/chat/data/`. Integrate
  `web/src/features/chat/state/useChatState.ts`, `web/src/features/chat/state/storage.ts`,
  `web/src/features/chat/conversation/useConversationComposer.ts`, and
  `web/src/features/chat/history/useHistoryWindow.ts` through explicit data boundaries.
- M4 adds the Centrifugo adapter in `src/sync/realtime.rs` and extends sync/jobs and chat data.
  Integrate `web/src/features/chat/conversation/useConversationMessageCommands.ts`, message
  metadata, drafts, and `web/src/routes/useChatRoute.ts`; preserve existing viewport/editor
  ownership.
- M5 extends `src/conversations/` and connected workflows in `web/src/features/communities/`,
  reusing account forms, ChatOwner, the pending store, and the connected conversation controls.
- M6 owns `src/media/`, S3/processing adapters, and existing composer attachments and media viewers.
  Replace `web/src/features/chat/composer/attachments/attachments.ts` local durable Data URLs.
- M7 extends messages/search and existing poll/checklist, forwarding, composer-form, search, and
  history modules. Keep file-reference rules owned by `src/media/`.
- M8 owns `src/notifications/`, `src/moderation/`, the service worker, and
  `web/src/features/admin/`; extend existing notification/settings UI rather than duplicating it.
- M9 owns `src/calls/`, the LiveKit adapter, and `web/src/features/calls/`; existing call entry
  points route into this module only when the server advertises it as enabled.
- Each owner adds ordered SQL migrations under `migrations/`, behavior-oriented integration tests
  under `tests/`, and connected browser scenarios under `web/e2e/`. Frontend unit tests stay near
  their owner. M10 extends deployment/CI and adds repeatable load/recovery tooling under `scripts/`.

## M1: Runtime, contracts, and reproducible environment

**Outcome:** A fresh checkout can build and start the root API and Worker independently, execute
migrations, and expose meaningful health/readiness through the same-origin gateway.

**Consumes:** Existing frontend and approved deployment boundaries.

**Produces:** Root Cargo package and two binaries; validated configuration; database migration
entry; shared application context; HTTP error/request-ID envelope; OpenAPI export and generated
frontend type check; real local PostgreSQL, Valkey, Centrifugo, and private RustFS environment.
LiveKit and mail can remain disabled profiles. No business tables are created speculatively.

- [x] Deliver the Rust runtime, explicit migration command/lock, dependency pinning, graceful
      shutdown, startup validation, and separate liveness/readiness behavior.
- [x] Deliver Compose networking, persistent volumes, same-origin frontend/API proxying, private
      service ports, safe example configuration, and separate browser/internal S3 addresses.
- [x] Deliver structured logging with secret filtering, backend CI, OpenAPI export/type-generation
      checks, and a documented clean-environment startup path.
- [x] Verify clean startup, unavailable required dependencies, competing migrators, process restart,
      and persistent database state using real services. Inspect that optional SMTP/LiveKit absence
      does not prevent core startup. Preserve existing frontend checks.

**Exit gate:** An operator can reproduce startup and diagnose dependency failures from the docs; API
and Worker restart separately without erasing persisted state. No directory-existence or
configuration-literal assertions substitute for these behaviors.

**Verification ownership:** `tests/runtime.rs`, backend CI, and root development/operations docs.
Use `cargo fmt --all --check`, `cargo clippy --locked --all-targets -- -D warnings`,
`cargo test --locked --all-targets -- --include-ignored` with an isolated PostgreSQL instance,
`pnpm --dir web api:check`, and `node scripts/check-runtime.mjs`. Setup and limits are documented in
[backend development](../../development.md) and [runtime operations](../../operations.md).

## M2: Accounts, sessions, contacts, and recovery

**Outcome:** A user registers, signs in, manages devices and contacts, and optionally verifies an
email for recovery through the actual frontend.

**Consumes:** M1 HTTP/database/configuration contracts.

**Produces:** Authenticated actor/session context, normalized username identity, authorization
middleware, privacy/contact/block state, session revocation, optional SMTP challenges, durable mail
delivery with job leases/fencing, and account capability responses. Later modules consume stable
user IDs, not display names or fixed demo IDs.

- [x] Deliver username/password registration, Argon2id verification, cookie sessions, CSRF/Origin
      checks, expiry, password change/reset, and recent-authentication checks.
- [x] Deliver profile text fields, bounded discovery, contacts, blocks, privacy preferences, device
      listing/revocation, email verification/change/removal, and single-use recovery challenges.
      Avatar upload is explicitly unavailable until M6 rather than stored as a fake remote file.
- [x] Deliver transactional mail-job creation, bounded retry, lease/fencing recovery, and protected
      challenge payloads. Recheck challenge expiry before delivery; tolerate repeated email delivery
      without permitting repeated token consumption. This is the first real Worker job consumer.
- [x] Deliver login/account routes and cache clearing on logout/switch. Preserve an explicit demo
      mode and remove fixed-user assumptions from connected-mode entry points.
- [x] Enforce account suspension, registration policy, and sensitive endpoint rate limits from the
      first account release. Bootstrap an operator identity without a public default password; the
      administration UI follows in M8. Report SMTP-disabled recovery accurately.
- [x] Verify normalized-username races, credential failures, CSRF rejection, revoked-session reads,
      one-time recovery, long/Unicode passwords, optional-email absence, and cross-account
      isolation.

**Exit gate:** Two independent real accounts can sign in and revoke devices; a revoked session
cannot access authenticated endpoints. No private settings are transferred between accounts.

**Verification ownership:** Account/session and HTTP tests under `tests/accounts.rs` and
`tests/account_http.rs`; relationship, operator, recovery, and queue tests in their corresponding
root test files; ownership/component tests beside the frontend features; and
`web/e2e-accounts/accounts.spec.ts`. Real PostgreSQL, Valkey, Mailpit, and built-browser workflows run
through `node scripts/check-runtime.mjs`. Repeatable commands and limits are documented in
[backend development](../../development.md) and [frontend development](../../../web/docs/development.md).

## M3: First durable direct-message flow

**Outcome:** Two accounts discover each other, exchange real text/rich-text messages, reload, and
retrieve authoritative history. The first vertical flow works without Centrifugo by HTTP catch-up.

**Consumes:** M2 actor, session, contact/block, and policy contracts.

**Produces:** Canonical direct/Saved conversations; account capacity accounting; message UUID,
sequence and version contracts; operation receipts; committed personal change groups; bootstrap,
incremental sync, and keyset history APIs; persistent pending text sends and canonical cache models.

- [x] Deliver canonical direct-pair/Saved uniqueness, first-message visibility, both-account
      capacity checks, personal settings records, and shared query/mutation authorization
      predicates.
- [x] Deliver send transactions containing message, summary/unread state, operation receipt, change
      groups, and job intent. Use transactionally locked per-account sync counters and stable lock
      order. General receipt cleanup cannot permit reuse of a deleted message identity.
- [x] Deliver versioned text/semantic-HTML/custom-emoji validation with canonical server text and
      explicit UTF-16 ranges. Preserve the supported rich-editor structures before exposing sends.
- [x] Deliver snapshot-consistent bootstrap and paged sync/history; connect the existing composer
      and timeline through the new data owner. Persist pending sends before network submission and
      show queued/sending/accepted/failed accurately. Use HTTP polling as the initial live adapter.
- [x] Extend M2's durable jobs with committed message-change wakeup intent. Keep intent coalesced
      while realtime is disabled; M4 adds its delivery adapter. Do not claim empty worker runs
      published notifications, and do not accumulate one undeliverable job per message.
- [x] Verify lost responses after commit, same-operation replay after restart, conflicting payload
      reuse, duplicate first-chat creation, capacity rejection without partial changes, and rollback
      without partial recipient feeds. Test stalled concurrent cursor allocation and rich-text
      parity for tables, lists, formulas, dates, and custom emoji.

**Exit gate:** A dropped response followed by a retry produces exactly one canonical message. Two
users can recover accepted messages after reload/restart, and unknown or unauthorized history IDs do
not leak content. Connected mode does not load all message history into memory.

**Verification ownership:** `tests/messages.rs`, `tests/sync.rs`, rich-text contract fixtures, and
`web/e2e-accounts/direct-messaging.spec.ts`. A real HTTP/PostgreSQL fault harness is required for
commit/response ambiguity; mocked dispatch success is insufficient.

**Implemented:** The connected account workspace now owns durable pending text sends and a bounded
remote history projection. Existing rich composition and rendering use authenticated identities.
Runtime guarantees and M4 boundaries are documented in [durable messaging](../../messaging.md).
Repeatable verification includes real PostgreSQL/Valkey tests, shared rich-content fixtures, frontend
unit/demo/connected browser suites, and the Compose committed-response-loss/API-restart gate.

## M4: Realtime, multiple devices, and message lifecycle

**Outcome:** Conversations stay correct across multiple devices, tabs, restarts, and long offline
periods while supporting the normal edit/read/reply workflow.

**Consumes:** M3 canonical entities, versions, durable feeds, history, and pending-operation
receipts.

**Produces:** Centrifugo personal wakeups, connect/refresh authorization, durable cache checkpoints,
reset-required handling, conflict-aware drafts, read cursors, message tombstones, and retryable
jobs.

- [x] Deliver Worker wakeup publication with coalescing, duplicate safety, bounded retry/backoff,
      lease recovery, and operator-visible exhausted work. Authenticate Centrifugo proxy callbacks,
      restrict personal subscriptions, and enforce session disconnection/refresh rules.
- [x] Deliver serialized sync application and atomic IndexedDB state/checkpoint commits. Handle
      retention-floor resets, account/view generations, stale responses, multi-tab compare-and-set,
      bounded cache eviction, reconnect/focus catch-up, and periodic lost-wakeup recovery.
- [x] Deliver conflict-aware synchronized drafts, conditional draft clearing on send, monotonic read
      receipts/unread counts, archive/mute/pin/manual-unread settings, personal hides/clear/close,
      and direct-chat reopening capacity rules.
- [x] Deliver authorized message edits/deletes, reply targets/quotes, pins, reactions, service
      events, and expiry policies. Enforce expiry in reads/actions before asynchronous cleanup. Keep
      separate content, draft, access, and interaction versions.
- [x] Verify duplicate/out-of-order wakeups, cleared Valkey, expired sync cursors, Worker crashes,
      storage quota failure, stale page arrival after deletion, old-tab checkpoint writes, account
      switching, conflicting edits/drafts, and sending followed immediately by more typing.

**Exit gate:** Four sessions across two accounts converge after a mixed edit/delete/read sequence,
including after full reset. Centrifugo failure does not lose committed messages. Reply jumps and
incoming messages preserve existing reading-position and editor behavior.

**Verification ownership:** `tests/message_lifecycle.rs`, `tests/conversation_state.rs`,
`tests/sync_jobs.rs`, `tests/realtime.rs`, browser data-owner tests,
`web/e2e-accounts/synchronization.spec.ts`, and `scripts/check-synchronization.mjs`. Use real
Centrifugo/Valkey and multiple browser contexts, including two tabs sharing one cache.

## M5: Groups, channels, discovery, and membership

**Outcome:** Users discover/join public communities, accept private invitations, and use groups or
channels with actual owner/admin/member permissions.

**Consumes:** M2 account policy and M3-M4 message/sync/conversation contracts.

**Produces:** Public/private discovery, roles/ownership, invitations/requests, bans/mutes, channel
publisher identity, permission-filtered membership views, and access-removal/generation updates.

- [x] Deliver group/channel creation, public handles/discovery, public/private transitions, direct
      invitations, hashed expiring/use-limited links, join requests/approval, and membership caps.
- [x] Deliver owner/admin/member rules, ownership transfer, leaving, removal, mute/ban, conversation
      deletion, and full retained-history access for admitted members. Quarantine state must already
      participate in shared authorization even though its admin UI arrives in M8.
- [x] Extend send/edit/delete/pin/expiry, feed fanout, history, and personal-list operations to real
      membership. Channel messages retain the authenticated actor for auditing while displaying the
      channel identity. Do not disclose subscriber lists to ordinary subscribers.
- [x] Connect creation, discovery, invitation, details, and member-management frontend surfaces;
      remove local-only permission claims from connected mode.
- [x] Verify join/send and leave/send races, final invite-use races, approval after revocation,
      normalized public-handle uniqueness, ownership transfer, banning/rejoining, directory limits,
      and public-to-private discovery removal. Check removed clients purge cached history.

**Exit gate:** Public and private group/channel workflows work with at least owner, administrator,
member, nonmember, and banned accounts. Every history/action endpoint enforces the same policy; UI
hiding is never the only protection.

**Verification ownership:** `tests/conversations.rs`, extensions to sync/message tests, and
`web/e2e-accounts/communities.spec.ts`. Include the configured 200-member/500-subscriber boundary
behavior without claiming throughput until M10's measurements.

## M6: Private media and recorded voice messages

[Detailed M6 design](../specs/2026-11-11-m6-private-media-design.md) and
[private media guide](../../media.md).

**Outcome:** Users send and view real photos, albums, documents, videos, and recorded voice
messages; avatars use the same validated media lifecycle.

**Consumes:** M3-M5 message references, actor/membership authorization, durable jobs, and sync.

**Produces:** Upload reservations, immutable ready-file IDs, variants, quota accounting, signed
authorized downloads, media-processing jobs, recording/playback integration, and reference-aware GC.

- [x] Deliver reserved/quota-checked single/multipart uploads, authenticated completion, worker
      validation, distinct immutable final candidates, fenced finalization, and safe retries.
- [x] Deliver bounded image/video/voice processing, posters/thumbnails/playback variants/waveforms,
      original downloads, isolated processing, and explicit progress/rejection states.
- [x] Deliver message-bound signed downloads, private buckets/media origin, MIME/content-disposition
      safeguards, Range/CORS integration, account/deployment budgets, and abandoned-upload cleanup.
      Avatar downloads use explicit profile/conversation references with the corresponding metadata
      visibility rules; an avatar cannot expose unrelated original uploads.
- [x] Connect composer paste/drop/file selection, albums, video/documents, voice recording, avatar
      upload, and the existing viewer. Preserve stable media occurrence identity and geometry.
- [x] Deliver reference locking and GC so deletion/expiration can remove unused objects without
      affecting live references. Add coordinated media-backup requirements now rather than waiting
      to discover missing filer state during final recovery testing.
- [x] Verify staging overwrite, codec limits and network isolation, Worker takeover, interrupted
      multipart uploads, quota races, reference access, collection, and paired backup recovery.
      Verify recording and playback in desktop Chromium.
- [ ] Verify microphone permission, recording, cancellation, and playback on physical iOS Safari
      and Android Chrome.

**Exit gate:** Reopening the same browser session restores an in-progress media send and resumes
from confirmed multipart uploads. The pending bubble becomes one accepted message. Only validated
immutable objects become attachable. An inaccessible or expired message cannot mint fresh download
URLs, and media failure leaves text messaging usable.

**Verification ownership:** `tests/media.rs`, `tests/media_jobs.rs`,
`web/e2e-accounts/media-messaging.spec.ts`, and existing attachment and viewer tests. Record
physical iOS Safari and Android Chrome results in the
[browser capability checks](../../../web/docs/development.md#connected-media-capability-checks).

## M7: Complete message interactions and history discovery

[Detailed M7 design](../specs/2026-11-11-m7-message-interactions-design.md) and
[implementation plan](./2026-11-12-m7-message-interactions.md).

**Outcome:** The existing advanced frontend capabilities operate on shared server state: search,
forwarding, interactive polls/checklists, bundled assets, contact cards, and safe link previews.

**Consumes:** M3-M6 content/version/permission/file/reference/history contracts.

**Produces:** Interactive-message commands and authorized projections; forwarding policy/copy
semantics; catalog IDs; permission-filtered substring search and target neighborhoods; preview jobs.

- [x] Deliver polls, quiz answers, hidden results, voter privacy, permitted option additions, early
      closing, and transactional vote replacement. Deliver versioned checklist tasks and structural
      updates, including participant permissions and conflict responses.
- [x] Deliver forwarding and bounded batch actions with per-destination operation identity,
      conversation forwarding policy, persistent attribution, independent file references, and
      noninteractive sanitized poll/checklist snapshots. Preserve the destination's existing draft.
- [x] Deliver server-managed bundled sticker/custom-emoji catalogs and contact-card serialization;
      preserve asset licenses and avoid arbitrary client-provided asset paths.
- [x] Deliver conversation/global search with visibility checks, Chinese/English substring behavior,
      bounded short-query work, filters, date anchors, pins, and media-history pagination. Connect
      sidebar/chat search and distant navigation without loading the intervening history.
- [x] Deliver asynchronous text link previews with site name, title, and summary. Isolate network
      egress, check destinations and redirects, bound fetches, and fence edits and deletions.
      Thumbnail support is deferred.
- [x] Verify concurrent votes, hidden quiz secrets, checklist conflicts, forwarded-copy survival
      after source deletion, forwarding-policy changes, reference/GC races, inaccessible search
      results, short Chinese queries, and SSRF/redirect/rebinding cases.

**Exit gate:** All supported current message kinds have a real authoritative path or an explicitly
documented excluded creation mode. Search and advanced actions never bypass the same visibility
predicate used by ordinary history. No local aggregate is trusted as a server result.

**Verification ownership:** `tests/message_interactions.rs`, `tests/forwarding.rs`,
`tests/search.rs`, `tests/link_previews.rs`, and `web/e2e-accounts/message-interactions.spec.ts`. Extend
existing poll/checklist, forwarding, search, and viewport browser tests instead of duplicating their
behavior.

## M8: Notifications, moderation, and account lifecycle

**Outcome:** Messaging is feature-complete for controlled acceptance, with optional offline
notifications and the administrative tools needed before public release.

**Consumes:** M2-M7 identity, policy, jobs, message/resource types, and real sync state.

**Produces:** Session-owned push subscriptions, notification eligibility/dedup, report evidence,
audited admin operations, quarantine/suspension/restoration flows, and complete account deletion.

- [ ] Deliver optional Web Push, the service worker, subscription lifecycle, foreground suppression,
      generic default payloads, mute/block/read rechecks, retry/dedup, and capability-aware UI.
- [ ] Deliver administrator screens for registration policy, suspensions, reports, conversation
      quarantine/restoration, quotas, and failed-job inspection/retry. Reuse the existing policy
      checks, require recent authentication, and audit every privileged operation.
- [ ] Deliver bounded report evidence with restricted access and retention cleanup. Complete account
      deletion, ownership-transfer prerequisites, deleted-author presentation, private-state
      cleanup, push detachment, and email/settings consistency across devices.
- [ ] Deliver privacy-respecting presence/typing using expiring state and limited observation;
      synchronize account-wide settings while preserving device-local appearance/input preferences.
- [ ] Verify push duplicates/late delivery, revoked subscriptions, read/mute suppression, evidence
      after source deletion, unauthenticated admin access, quarantine restoration, suspended-account
      login/read attempts, and deletion of an account that still owns a community.

**Exit gate:** Controlled messaging acceptance covers optional email/push absence, moderation and
restoration, and account lifecycle. No public release is implied; M10 still owns measured operations
and cross-browser/recovery acceptance. Calls remain visibly unavailable until M9.

**Verification ownership:** `tests/notifications.rs`, `tests/moderation.rs`,
`tests/account_lifecycle.rs`, `web/e2e/administration.spec.ts`, and service-worker/browser
notification checks. Provider-backed push delivery requires an explicitly configured environment;
deterministic tests alone cannot claim all browser/OS background behavior.

## M9: Independent one-to-one LiveKit calls

**Outcome:** Contact-authorized users place and answer one-to-one audio/video calls, including
multi-device ringing and controlled failure/reconnect behavior.

**Consumes:** M2 privacy/sessions, M3-M4 durable events/jobs, M5 shared authorization, and M8
notifications/moderation hooks. Ordinary messaging must work with the calls profile disabled.

**Produces:** Authoritative call state and active slots, designated sessions, scoped room tokens,
verified webhook receipts, timeout/reconciliation jobs, and one terminal chat service event.

- [ ] Deliver ringing/connecting/active/ended transitions, end reasons, stable account-slot locking,
      call quotas, first-device acceptance, and cancel/accept/cross-call race handling.
- [ ] Deliver room creation/cleanup through the LiveKit adapter, scoped designated-session tokens,
      two-participant limits, verified/deduplicated webhooks, reconnect grace, and reconciliation.
- [ ] Deliver call UI, ringing on eligible devices, explicit microphone/camera access, device
      selection, mute, video enablement, and readable transport/permission failures.
- [ ] Wire session revocation, blocking, suspension, and call timeout to terminal state/cleanup.
      Never reuse room names; validate the pinned server's refreshed-token behavior and document
      obsolete-room residual access rather than claiming instantaneous token revocation.
- [ ] Deliver the optional LiveKit/TURN Compose profile, public address/TLS/port documentation, and
      tests using real distinct networks, including TURN fallback and media-service interruption.
- [ ] Verify two-device acceptance, simultaneous calls, delayed/duplicate webhooks, hangup followed
      by stale tokens, permission refusal, reconnect expiry, and exactly one terminal service event.

**Exit gate:** Calls work across real networks and fail independently of chat. Terminal calls never
revive, and a credential for an old room cannot authorize a future call. No guaranteed wakeup of a
closed/suspended browser is advertised.

**Verification ownership:** `tests/calls.rs`, `tests/livekit_integration.rs`, and
`web/e2e/calls.spec.ts`, plus real microphone/camera/TURN checks. Two browser tabs on one laptop do
not complete this milestone's network acceptance.

## M10: Release, performance, and recovery acceptance

**Outcome:** The complete product can be deployed, upgraded, observed, backed up, and restored under
documented operating limits. This stage resolves measured failures; it does not invent new scope.

**Consumes:** All prior increments and their repeatable checks, deployment assets, and metrics.

**Produces:** Release/upgrade and recovery procedures, measured capacity results, bounded failure
behavior, browser capability record, and a complete product acceptance record tied to a revision.

- [ ] Complete deployment hardening: pinned images, secret/configuration handling, private service
      boundaries, explicit migrations, compatible upgrade/rollback procedure, and graceful shutdown.
- [ ] Exercise dependency outages, backlog limits, poison jobs, rate-limit-store loss, worker lease
      expiry, repeated restarts, and restoration of realtime after broker loss. Verify monitoring
      detects lag/capacity problems without recording secrets or message bodies.
- [ ] Measure the agreed workload: 1,000 accounts, 100 connected clients, 10 sends/second across 20
      conversations, separate 200-member/500-subscriber fanout cases, million-message history, and
      10 simultaneous one-to-one calls. Document hardware and do not combine independent maxima into
      an unverified claim. Tune configuration or fix bottlenecks before accepting the results.
- [ ] Run coordinated off-host PostgreSQL and RustFS backups and an isolated restore drill. Verify
      filer/object references, permissions, retained forwarded attachments, rotated sync epoch, and
      client reset. Demonstrate the one-hour RPO/four-hour RTO targets or explicitly report the gap.
- [ ] Verify desktop Chrome/Firefox/Safari/Edge, real iOS Safari and Android Chrome, touch/history
      behavior, voice formats, uploads, calls, and capability-dependent push. Record actual support
      rather than extrapolating the existing Chromium suite.
- [ ] Run all approved design acceptance scenarios against the release candidate, resolve failures,
      and consolidate lasting implementation/operations guidance into owning documents. Retain
      active plans; remove superseded work documents only in a requested consolidation.

**Exit gate:** Every design acceptance scenario has evidence at the candidate revision. Unsupported
capabilities and measured limitations are explicit. A successful local Compose launch or large unit
test count alone does not qualify as release readiness.

**Verification ownership:** All backend/browser suites, `scripts/` load/recovery tools, deployment
checks, and root operations/development documentation. Use `cargo test --all-targets`, Rustfmt,
Clippy, frontend unit/build/format checks, service-backed browser/integration suites, and the actual
restore/network drills after those tools exist. Never present this roadmap as results already run.

## Design coverage and ownership

| Design area                              | Owning milestones                               |
| ---------------------------------------- | ----------------------------------------------- |
| 1. Product intent, scope, limits         | All; load verification in M10                   |
| 2. Frontend boundary                     | M2-M4, then each feature owner                  |
| 3. Runtime/repository structure          | M1, extended by each owner                      |
| 4. Accounts, sessions, contacts, privacy | M2; deletion/presence completion in M8          |
| 5. Conversation types and authorization  | M3-M5; admin quarantine actions in M8           |
| 6. Message semantics                     | M3-M4 and M7; media references in M6            |
| 7. Durable sync and realtime             | M3-M4; fanout expansion in M5                   |
| 8. History, drafts, search, cache        | M3-M4; search/media navigation in M7            |
| 9. Files and previews                    | M6; forwarding/preview integration in M7        |
| 10. Notifications and administration     | M2/M5 enforcement; complete workflows in M8     |
| 11. Calls                                | M9                                              |
| 12. Data model and transaction ownership | Each owner; shared invariants in M3-M4          |
| 13. HTTP/event contract                  | M1 baseline; contracts evolve with each feature |
| 14. Worker/failure semantics             | M2-M4, M6, M8-M9; full failure checks in M10    |
| 15. Deployment and recovery              | M1 setup; M6/M9 integrations; M10 acceptance    |
| 16. Acceptance                           | Incremental checks; rerun everything in M10     |
| 17-18. Discretion and references         | Applies throughout                              |

The design's numbered acceptance scenarios map as follows:

- Scenarios 1-2: M2-M4 and M6; complete cross-device/media flow checked again in M10.
- Scenarios 3-4: M3-M4 and M10.
- Scenarios 5 and 7: M3-M6, with moderation/restoration extended in M8.
- Scenario 6: M7, using the M4 expiry and job-failure controls.
- Scenario 8: M6-M7.
- Scenario 9: M3-M4 and M7, then the million-message workload in M10.
- Scenario 10: M2 and M4.
- Scenario 11: M2 and M8.
- Scenario 12: M9.
- Scenarios 13-14: incremental runtime/job checks, then M10's full recovery and load acceptance.

## Planning and execution discipline

When a milestone is selected for implementation, read the current source and this approved design,
then write that milestone's focused execution plan in this directory. Fix concrete schemas, public
interfaces, files, test assertions, commands, and dependency versions at that time. Avoid freezing
every future function signature before its preceding integration is implemented.

Use this cycle for each independently reviewable task inside the selected milestone:

- [ ] Identify one observable behavior and the owning module/API boundary.
- [ ] Add or update the smallest meaningful regression/behavior test and observe the expected
      failure. Do not add ceremonial tests for scaffolding, formatting, or literal settings.
- [ ] Implement the behavior, including its required permission, transactional, and failure rules.
- [ ] Run relevant checks and exercise the real dependency when its semantics determine correctness.
- [ ] Review the diff and interfaces, update user-facing capability state and owning documentation,
      then commit one coherent responsibility using Conventional Commits.

A milestone is complete only after its exit gate passes in an integrated environment. Document
partial results accurately; do not call a mocked workflow a completed service integration. Do not
request approval again for previously approved product defaults unless new evidence requires a
material design change. Execution method and actual implementation start remain a later instruction;
this roadmap does not start work automatically or create branches/worktrees.
