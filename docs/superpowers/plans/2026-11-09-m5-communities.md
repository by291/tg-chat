# M5 communities implementation plan

> **Execution:** Use `superpowers:executing-plans` inline, with one fresh whole-change review.

**Goal:** Deliver public/private groups and channels with enforceable membership and usable management.

**Architecture:** Extend the existing conversation aggregate and personal feed. All membership and
message mutations lock the conversation first, followed by affected accounts in UUID order.
PostgreSQL owns roles, bans, invitation limits, requests, and access generations. Existing HTTP
snapshot authorization and browser invalidation remain the only routes to private content.

**Tech Stack:** Existing Rust/Axum/SQLx/PostgreSQL, SHA-256, React, IndexedDB, and Docker Compose.
Prefer existing maintained libraries; no new protocol or crypto implementation is necessary.

**Spec:** [Approved product design](../specs/2026-11-08-complete-product-design.md), sections 4–8,
10, and 12; [M5 contract](2026-11-08-product-milestones.md#m5-groups-channels-discovery-and-membership).

## Global constraints

- Continue the current checkout on main, with grouped local Conventional Commits and no push.
- Preserve 200 directory memberships plus Saved, 200 group members, and 500 channel subscribers.
- Members read all retained history, subject to personal hide/clear. Leaving revokes all access.
- Administrators manage ordinary members; only owners manage administrators, transfer, or delete.
- Channels display the channel identity while retaining the authenticated author for audit.
- Private, deleted, quarantined, and banned conversations never appear in public discovery.
- Channel subscriber lists are restricted to administrators and the subscriber's own membership.
- Preserve M3/M4 operation identity, atomic feed/cache checkpoints, draft ownership, and expiry.
- Follow all readability, English code/documentation, formatter, and behavioral-test requirements.
- Avatar uploads, media, search inside messages, presence, and calls retain their later milestones.

## Implementation decisions

Public handles use lowercase ASCII letters, digits, and underscores, 3–32 characters. Titles admit
1–128 characters and descriptions at most 2,000. Discovery and member/request/invitation lists are
bounded and paginated. Community metadata changes are explicit desired-state commands.

Invite links use a client-generated 256-bit random secret transmitted over the authenticated command
boundary; the database stores its SHA-256 hash only. The client retains the secret for sharing and
stable retries. Expiry defaults to seven days; explicit expiry and positive use limits are validated.
Direct invitations name one target and require acceptance. Approval-enabled public/link joins create
requests; approval rechecks the current invitation, ban, suspension, membership, and capacity.
Invitations do not reserve a directory slot. Public-to-private transitions cancel public requests.

## Review focus

- Removal racing sends or delayed command/history responses must never recreate private access.
- Last invitation use, stale approval, and concurrent joins must not over-admit members or directories.
- Channel projections and member pages must not disclose subscriber identities to ordinary users.
- A stale administrator cannot manage an owner/admin after ownership or role changes.
- Quarantine must reject every ordinary read/write, including replay, bootstrap, and reply projection.

### Task 1: Community storage and shared authorization

**Files:** migration `202611090006_communities.sql`, `src/conversations/access.rs`,
`src/conversations/mod.rs`, `src/messages/`, `src/sync/snapshots.rs`, `src/jobs/maintenance.rs`,
`tests/conversations.rs`.

**Interfaces:** Extend `LockedConversation` with community state and its locked participant set;
provide `is_community`, `require_manager`, and membership-based send authorization. Extend directory
projections with title, description, public handle, role, and explicit posting/management permissions.

- [x] Write real PG tests proving admitted members see retained history, outsiders cannot read,
      muted members cannot post, channel subscribers cannot post, and quarantine removes access.
- [x] Observe the failing tests, implement schema and shared visibility/permission predicates, then
      extend message fanout, moderator deletion, pin/expiry roles, and maintenance recipients.
- [x] Run the targeted real PG suite, Rustfmt, and full Rust suite; preserve all M3/M4 behavior.
- [x] Commit storage/authorization separately from later membership commands.

### Task 2: Transactional community lifecycle and membership

**Files:** new `src/conversations/community_model.rs`, `community_service.rs`, `membership.rs`,
`tests/conversations.rs` and shared test fixtures.

**Interfaces:** `MessageService::create_community(actor, CreateCommunity) -> CommunityReceipt` and
`MessageService::community_command(actor, CommunityCommand) -> CommunityReceipt`, each carrying a
stable operation ID. Reuse the existing command identity boundary and return current authorized state.

- [x] Write failures for create/join/leave, ownership transfer, role escalation, remove/ban/unban,
      personal clear on rejoin, deletion, normalized handle collisions, and directory/member limits.
- [x] Implement conversation-first transactions and account capacity locks, idempotent commands,
      role checks, membership generations, and feed changes including removed members.
- [x] Run concurrent join/send and leave/send tests plus complete backend tests; commit by ownership.

### Task 3: Invitations, approvals, discovery, and HTTP contracts

**Files:** new `src/conversations/invitations.rs`, `community_queries.rs`, `http.rs`,
`src/accounts/http.rs`, `src/http.rs`, `tests/conversations.rs`, `tests/community_http.rs`, contracts.

**Interfaces:** Authenticated community discovery/details/member/request/invitation queries;
create/command endpoints reuse cookie, Origin, CSRF, body limits, and rate-limit boundaries.
Invitation previews expose only minimal identity; direct invitation inbox is recipient-owned.

- [x] Write failures for final-use races, expiry/revocation, approval after revocation, targeted invite
      acceptance, banned rejoin, public-to-private discovery/request removal, and subscriber privacy.
- [x] Implement hashed secrets, bounded paginated views, current-state approval validation, and routes.
- [x] Generate OpenAPI/frontend types; run real PG/HTTP tests, full backend suite, and Clippy.
- [x] Commit invitation/discovery and API integration by responsibility.

### Task 4: Connected community workflows

**Files:** new `web/src/features/communities/`, connected chat controls and data-owner integration,
owner/UI behavior tests.

**Interfaces:** Community screens use the authenticated SessionOwner client and stable operation IDs.
Successful commands trigger existing feed catch-up; opening a community selects its conversation ID.
Permissions come from server projections; channel rendering uses publisher identity.

- [x] Write failures for community selection, subscriber composer restrictions, membership revocation,
      and stable retries. Reuse existing generic cache-removal tests instead of duplicating them.
- [x] Connect create/discover/join/invitation inbox, details, settings, member roles, invitations,
      requests, leave/delete confirmations, and ban/mute controls to the actual API.
- [x] Run frontend unit tests, build, formatting, API drift, and demo browser checks.
- [x] Commit data integration and community UI by responsibility.

### Task 5: Full workflow acceptance and documentation

**Files:** `web/e2e-accounts/communities.spec.ts`, browser configuration/package scripts,
`scripts/check-runtime.mjs`, `docs/communities.md`, existing development/architecture docs and roadmap.

- [x] Exercise owner, admin, member, outsider, and banned accounts through real public/private group
      and channel flows; verify removed clients purge history and cannot reload it.
- [x] Run full Rust/frontend/static checks and isolated Compose acceptance including M3/M4 suites.
- [x] Document current membership/authorization ownership and repeatable checks; update M5 status.
- [x] Commit acceptance and documentation separately.

### Task 6: Whole-change review and final verification

- [x] Dispatch one fresh independent reviewer with the complete baseline diff, spec, plan, and ledger.
- [x] Regrade findings by user effect; fix important issues in one consolidated RED→GREEN pass.
- [x] Run applicable final checks, commit fixes by responsibility, and verify a clean checkout.
- [x] Remove only this milestone's scratch/runtime; preserve local commits and report in Chinese.
