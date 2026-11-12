# M9 One-to-One LiveKit Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Track
> progress with checkboxes.

**Goal:** Deliver voice and video calls from existing direct chats, with first-session
acceptance and one durable call record.

**Architecture:** PostgreSQL owns calls and deadlines. The API authorizes commands and
room credentials. The Worker owns LiveKit room operations and history publication.
Centrifugo hints prompt clients to fetch a private snapshot.

**Tech Stack:** Rust, Axum, SQLx, PostgreSQL, Centrifugo, LiveKit, React, and Playwright.

**Spec:** [Approved M9 design][spec], [product design][product], and [roadmap][roadmap].

## Global constraints

- Start in the current checkout. Commit the reviewed plan before code and use one local
  Conventional Commit per responsibility group. Run each focused regression before and after
  implementation. Verify the failure is the missing behavior or contract.
- Follow [AGENTS.md](../../../AGENTS.md). Use logical blank lines between preparation,
  authorization, mutation, and publication. Give each public function a one-line English
  purpose comment. Place short English comments beside complex branches and choices that
  depend on lock order, ownership, idempotency, timing, or recovery. Run Rustfmt and Prettier.
  Apply the limits on line length, nesting, chains, parameters, and positional booleans.
- Use existing direct-chat, privacy, and account/session checks. Expose call actions only
  for an existing direct chat. No new call can create a direct conversation. Incoming calls
  ring in connected sessions. Closed browsers receive the terminal record in chat history.
- Preserve the repository lock order. Lock the conversation, sorted account rows, applicable
  sessions, then the call. Take the deployment admission lock only on new starts before slot
  insertion. Allocate messaging positions last. Perform external requests after committing.
- Use database time for ringing, setup, and reconnect deadlines. Use 30 seconds for ringing,
  30 seconds for setup after acceptance, 30 seconds for a continuous media departure, and
  60 seconds for application-issued join tokens. Treat these as starting implementation
  defaults. A token's expiry is independent of a call's deadline.
- Allow one live slot per account, 10 concurrent calls per deployment by default, and five
  new admitted starts per caller per minute. Make the deployment limit configurable. Apply the
  existing admission limiter to repeated start requests. Replaying a committed operation
  cannot allocate slots or create a history record again.
- Generate OpenAPI and TypeScript contracts in the commit that changes them. Keep UUIDs opaque
  and revisions as decimal strings. Keep credentials out of logs, realtime hints, persisted
  browser state, and history. LiveKit is optional and cannot be a chat readiness dependency.

## Responsibility and order

1. **Runtime and compatibility** owns the optional profile, pinned packages, and room contract.
2. **Call state and API** owns the PostgreSQL state machine, slots, snapshots, and call hints.
3. **Termination and history** owns policy changes and exactly-once chat publication.
4. **Room lifecycle** owns provisioning, scoped credentials, and cleanup.
5. **Media reconciliation** owns verified observations, reconnect deadlines, and failure recovery.
6. **Connected call UI** owns ringing, tab ownership, device controls, and media feedback.
7. **Acceptance** owns the full runtime gate, cross-network verification, and operating docs.

Call-specific Rust modules live under `src/calls/` and the connected UI under
`web/src/features/calls/`. Reuse `src/conversations/access.rs` for direct access,
`src/realtime/client.rs` for publication, and the existing message sequence and projection
paths for call records. Introduce provider boundaries only where a real adapter and a
deterministic test implementation share the contract.

## Review focus

- **Task 1.** The pinned provider can create and remove the two-participant room.
- **Task 2.** A stale accept waiting on a lock cannot claim a call after its ringing deadline.
- **Task 3.** A full chat wakeup queue cannot prevent terminal state or release of both slots.
- **Task 4.** An in-flight create that completes after termination cannot publish credentials.
- **Task 4.** A valid credential for a terminal call cannot pass the application gateway.
- **Task 5.** A delayed leave or room query cannot replace a newer connection observation.
- **Task 6.** A delayed media grant after logout cannot reopen a microphone or camera.

## Task 1 — Optional runtime and LiveKit compatibility

**Files.** Add `deploy/livekit.yaml` and `tests/livekit_integration.rs`. Extend `compose.yaml`,
`.env.example`, `Cargo.toml`, `Cargo.lock`, and `web/{package.json,pnpm-lock.yaml}`.
Use `web/e2e-accounts/livekit-contract.spec.ts` and `web/playwright.calls.config.ts`
for provider-facing browser assertions. Exclude that fixture in
`web/playwright.accounts.config.ts`.

**Interface.** Profile `calls` starts LiveKit. `TG_CHAT_CALLS_ENABLED` defaults to false.
Use separate `TG_CHAT_LIVEKIT_INTERNAL_URL` and `TG_CHAT_LIVEKIT_PUBLIC_URL` settings, plus
server-only `TG_CHAT_LIVEKIT_API_KEY` and `TG_CHAT_LIVEKIT_API_SECRET`. Validate the public
signaling URL as WSS with a loopback WS exception for local tests. Use a private webhook route
at `POST /internal/livekit/webhook` once Task 5 lands.

- [ ] Pin the first candidates to [LiveKit Server 1.13.11][server],
  [livekit-api 0.10.1][rust-sdk], and [livekit-client 2.24.0][browser-sdk]. Use only
  server API, token, and webhook support in Rust. The browser pin serves the
  integration fixture first and the connected UI in Task 6.
- [ ] Verify the pinned provider explicitly creates a room, admits the two participants,
  rejects a third, and reports room removal after deletion. Keep credentials in memory in
  the disposable provider fixtures.
- [ ] Run `cargo test --locked --test livekit_integration -- --include-ignored` against
  the disposable profile. Run the browser contract using
  `pnpm --dir web exec playwright test -c playwright.calls.config.ts livekit-contract.spec.ts`.
  Supply its settings explicitly. Missing profile configuration fails the targeted checks.
- [ ] Configure explicit room creation with `room.auto_create: false`. Set empty and departure
  timeouts beyond the app's setup and reconnect deadlines respectively. Record the
  observed behavior of the pinned server. The [open LiveKit room deletion report][room-issue]
  concerns an earlier release. The application gateway in Task 4 owns terminal admission,
  and the provider's signaling port stays private.
- [ ] Verify the profile also stops cleanly and the default runtime starts without LiveKit.
  Keep internal room administration and webhook ingress private. Commit
  `build(calls): pin the optional LiveKit runtime`.

## Task 2 — Authoritative call state and API

**Files.** Add `migrations/202611120014_calls.sql`, `src/calls/{mod,model,service,http}.rs`,
and `tests/calls.rs`. Extend `src/{lib,http,runtime}.rs`, `src/accounts/http.rs`,
`src/realtime/client.rs`, and the generated contracts.

**Interfaces.**

- `CallService::start(&self, actor: &Actor, input: StartCall) -> Result<CallView, AccountError>`.
  `StartCall` carries `operation_id`, `conversation_id`, and `mode` of `voice` or `video`.
- `CallService::command(&self, actor: &Actor, input: CallCommand)` returns the same result.
  `CallCommand` carries `call_id`, `operation_id`, and an action of `accept`, `decline`,
  `cancel`, `hangup`, or `media_permission_denied`.
- `CallService::current(&self, actor: &Actor) -> Result<Option<CallView>, AccountError>`.
  `CallView` includes ID, conversation ID, peer ID and display name, direction, mode,
  phase, revision, applicable deadline, optional end reason, and allowed actions.
  It exposes neither room name nor session identities. Later tasks extend it with
  `is_room_ready` and `reconnect_deadline`.
- `POST /api/v1/calls`, `POST /api/v1/calls/{call_id}/commands`, and
  `GET /api/v1/calls/current` return the private views above. The snapshot returns
  `{"call": null}` with no visible live call. Use existing cookie, Origin, and CSRF
  handling. Responses are `no-store`. Add `calls_available` to capabilities. Keep it
  false in the public runtime until the Worker and credential paths are wired in Task 5.

- [ ] Add `cross_calls_reserve_one_slot_per_account`,
  `first_accept_wins_and_late_accept_observes_current_state`, and
  `expired_ringing_rejects_accept_after_lock_wait`. Assert one persisted call and two
  slots for crossed starts, one accepting session, and zero successes past the deadline.
  Cover directional contacts, blocks, inactive sessions, quarantine, unsupported targets,
  capacity, operation ID replay, and a cancel that wins before acceptance.
- [ ] Run `cargo test --locked --test calls -- --include-ignored` on disposable PostgreSQL
  and confirm the new admission and race tests fail before adding the behavior.
- [ ] Implement call rows, per-account slots, bounded operation receipts, and revisioned
  transitions. Admit `ringing`, accept to `connecting`, and terminate irreversibly.
  A recipient session can accept or decline while ringing. The caller may cancel while
  ringing. Only the designated sessions may hang up after acceptance or report a required
  media permission denial during setup. Check deadlines with `clock_timestamp()` after
  lock waits. A stale authorized command returns a safe current view with no action.
  Reject conflicting operation payloads and unrelated callers. Map privacy refusal to
  `call_not_allowed` and occupied slots to `call_busy`, without identifying other calls.
- [ ] Return only visible current calls from the snapshot. End ringing at the database
  deadline even if maintenance is delayed. Wake both accounts after a committed revision
  with a best-effort private hint of `kind: "call"` and no payload identities. API and
  Worker transitions use the same publisher. Keep polling usable if hint delivery fails.
- [ ] Regenerate contracts with `pnpm --dir web api:generate`. Rerun the call tests and
  `pnpm --dir web api:check`. Commit `feat(calls): authorize and persist call sessions`.

## Task 3 — Terminal state and one chat record

**Files.** Add `src/calls/{termination,history}.rs` and
`migrations/202611120015_call_termination.sql`. Extend `src/calls/service.rs`,
  `src/accounts/{service,sessions}.rs`, `src/contacts/{mod,relationships}.rs`,
  `src/moderation/quarantine.rs`, and `src/realtime/worker.rs` at mutation and expiry paths,
`src/conversations/state.rs`, `src/messages/{acceptance,model}.rs`, and `tests/calls.rs`.

**Interfaces.** Use `finish_call(connection: &mut PgConnection, input: FinishCall)` to
record one reason and release slots inside the terminal transaction. Keep versioned cleanup
and history work keyed by call ID. `write_call_record(connection: &mut PgConnection,
record: &CallRecord)` inserts a `service_kind = "call"` event through the message identity
and sequence path. Store a separate server-generated message ID in the history work.
The call ID deduplicates publication and never doubles as a client-selected message ID.
Format the type, outcome, and server-derived duration in the existing service message content.

- [ ] Add `termination_releases_slots_while_history_publication_is_blocked`. Saturate
  the existing wakeup budget, end a call, and assert both slots release. Restore capacity
  and retry publication after a Worker restart. Assert one service event, one message
  identity, and no notification intent.
- [ ] Add `policy_mutation_fences_calls_and_spares_unrelated_sessions`. Check both block
  directions, suspension, deletion, quarantine, session expiry and revocation. Revoking
  a recipient session that did not accept must preserve the winning session.
- [ ] Run `cargo test --locked --test calls -- --include-ignored` and verify the new
  termination and history assertions fail before implementation.
- [ ] Record reasons `declined`, `cancelled`, `missed`, `completed`,
  `permission_denied`, `transport_failed`, and `access_revoked` for admitted calls.
  Busy or capacity-denied starts leave no record. Attach invalidation intents to existing
  account and conversation transactions. Preserve lock order by processing intents
  through the call Worker, and suppress stale ringing and joins as soon as policy changes.
  Reuse the shared revocation path for password rotation and recovery. Recheck changed
  audience for ringing calls and preserve established calls on audience change alone.
- [ ] Run bounded deadline and termination jobs. Commit the terminal row, slot release,
  and work intents together. Publish history in a separate retryable transaction that
  uses existing message sequence and sync rules. A normal history read shows the event
  only where the viewer has authorized conversation access.
- [ ] Rerun call, account lifecycle, moderation, notification, and sync regressions against
  disposable services. Commit `feat(calls): terminate calls and record one history event`.

## Task 4 — LiveKit room provisioning and credentials

**Files.** Add `src/calls/{livekit,rooms}.rs` and
`migrations/202611120016_call_rooms.sql`. Extend `src/calls/{http,model}.rs`,
`src/runtime.rs`, `tests/calls.rs`, `tests/livekit_integration.rs`, and contracts.

**Interfaces.** The adapter exposes `create_room(&self, input: RoomCreate)`,
`inspect_room(&self, room: &RoomIdentity)`, and `delete_room(&self, room: &RoomIdentity)`.
The room identity binds the stored unique name and observed LiveKit SID.
`POST /api/v1/calls/{call_id}/credentials` returns `{url, token, expires_at}` to a
designated eligible session. An otherwise eligible session gets a retryable
`call_room_pending` conflict while provisioning.

- [ ] Add `late_room_creation_is_cleaned_after_hangup` with a paused create completion.
  End the call before the response and assert the room is removed and no credential can
  be issued. Test a lost create response and retry against the same name.
- [ ] Add `only_designated_sessions_get_room_scoped_credentials`. Assert the losing
  recipient session, unrelated sessions, revoked sessions, and ended calls are denied.
  Inspect actual grants for one room, fixed participant identity, microphone/camera
  publish sources, and no room administration or data publishing.
- [ ] Run the focused call tests with the fake adapter, and the integration tests with
  the pinned profile. Confirm absent provisioning or credential enforcement fails.
- [ ] Lease room creation only after acceptance. Use a unique room name per call and
  the same name across create retries. Publish readiness only under the current call
  fence. Make deletion idempotent, including room-not-found, and preserve work to clean
  up a late create even after an earlier deletion succeeds. Delete by unique room name
  after verifying the terminal call. Use the SID to fence live observations.
- [ ] Recheck designation, current account/session access, block, quarantine, terminal
  state, and relevant deadlines at credential issuance. Mint locally with the official
  SDK. Keep credentials out of the generic call view and mark the response `no-store`.
- [ ] Route public signaling through the application gateway. Verify the signed room and
  participant identity and current call state before forwarding a new connection.
  Cover admission before and after termination with `gateway_admission_uses_current_designated_call_state`.
- [ ] Regenerate contracts and rerun call and LiveKit integration tests. Commit
  `feat(calls): provision rooms and issue scoped credentials`.

## Task 5 — Webhooks and bounded media recovery

**Files.** Add `src/calls/{webhook,reconciliation}.rs` and
`migrations/202611120017_call_observations.sql`. Extend `src/calls/{livekit,rooms}.rs`,
`src/http.rs`, `src/runtime.rs`, `deploy/livekit.yaml`, and call integration tests.

**Interfaces.** The private webhook verifies the original bytes with the SDK before
persisting a receipt keyed by LiveKit event UUID. A `RoomObservation` identifies the
expected room, participant identities and SIDs, observed media state, and observation
fence. `apply_room_observation(connection: &mut PgConnection, observation: RoomObservation)`
advances only the matching current call.

- [ ] Add `stale_leave_and_stale_probe_cannot_override_reconnect` and
  `missing_webhook_recovers_from_room_snapshot`. Cover invalid signatures, duplicate
  receipts, wrong room and participant, delayed completion after hangup, and Worker restart.
  Assert two confirmed media connections activate the call and only a current departure
  starts a reconnect deadline.
- [ ] Run the call and LiveKit tests to reproduce the missing webhook and recovery paths.
- [ ] Process signed receipts with bounded work and coalesce room probes. Probe connecting
  and active rooms at most every five seconds per call, and apply a probe only if the
  room and observation fence still match. Reconcile departures with current participant
  state, retain active phase through reconnect, and clear a grace deadline only on
  observed media recovery. Repeated departure or failed probes cannot extend it.
  Start a grace deadline on the first failed observation when the provider is unreachable.
  End once on setup or reconnect expiry and route late terminal-room activity to cleanup.
  Enable the capability only when the optional runtime has complete configuration.
- [ ] Rerun the suites, including dropped webhook and interrupted provider cases. Verify
  duplicate observations leave one terminal record. Commit
  `feat(calls): reconcile LiveKit media and reconnect deadlines`.

## Task 6 — Connected browser calls

**Files.** Add `web/src/features/calls/{CallOwner,CallPanel,LiveKitMedia,callTabOwner}`
using `.ts` for owners and the media adapter and `.tsx` for the panel. Extend
`web/src/features/accounts/AccountWorkspace.tsx`, `web/src/features/chat/data/ChatOwner.ts`,
`web/src/features/chat/connected/ConnectedChat.tsx`, `web/src/features/chat/data/messageModels.ts`,
and `web/{package.json,pnpm-lock.yaml}`. Add focused tests next to the call owners.

**Interfaces.** `CallOwner.connect(): () => void` subscribes and owns snapshot refresh.
`CallOwner.refresh(): Promise<void>` is the hint and poll entry point.
`CallOwner.start(input: { conversationId: string; mode: CallMode }): Promise<void>`
and `CallOwner.command(action: CallAction): Promise<void>` own operation replay.
`LiveKitMedia` owns one SDK room and releases tracks and listeners on disposal.

- [ ] Add focused tests for first answer on another session, duplicate hints, tab ownership,
  a stale credential response after logout, and an optional camera failure during a voice
  call. Assert the late response cannot connect and camera failure leaves audio running.
  Run `pnpm --dir web test src/features/calls` and confirm the missing behavior fails.
- [ ] Mount the owner at the authenticated workspace so navigating between chats and settings
  preserves the call panel. Branch call hints in the existing realtime listener. Poll connected
  sessions every five seconds as fallback and refresh on focus or reconnect. Coalesce requests
  and fence responses by session revision, call ID, and call revision.
- [ ] Use a browser Web Lock scoped to the app session and call to coordinate duplicate tabs.
  Release on tab teardown or termination. Reuse the same designated session on reload
  within the server grace period. Keep credentials and SDK rooms in memory and load the
  browser SDK only when needed. Show an unavailable call state on browsers without the
  secure media or tab ownership APIs.
- [ ] Wire voice/video buttons in existing direct chats, incoming controls and status,
  explicit media activation, mute, camera switching, microphone/camera selection, and
  hangup. Show setup, reconnecting, and readable failures. Dispose tracks on termination
  and on loss of session ownership. Render terminal records through the existing service
  message path, including missed calls, without replaying a ring.
- [ ] Run the focused tests, `pnpm --dir web build`, and `pnpm --dir web format:check`.
  Commit `feat(calls): connect ringing and media controls in the browser`.

## Task 7 — Runtime acceptance and documentation

**Files.** Add `web/e2e-accounts/calls.spec.ts`. Extend the calls configuration,
`web/{package.json,playwright.accounts.config.ts}`, `scripts/check-runtime.mjs`,
`docs/{development,messaging,operations}.md`, and the roadmap.

- [ ] Add `test:calls` using the existing connected Playwright configuration. Run with
  real PostgreSQL, Centrifugo, and the pinned LiveKit server. Use controlled Chromium
  media devices to verify two recipients race to answer, voice and video, mute, refused
  permission, refresh/reconnect, missed call after reopening, and one history record.
- [ ] Run the default isolated Compose runner with calls disabled. Add a calls-enabled
  mode to the runner that creates its own disposable project. Stop and restore LiveKit
  while checking normal chat sends and history. Verify M6 through M8 regressions through
  the default runner.
- [ ] Run the local gates and confirm all commands exit successfully.

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
node scripts/check-runtime.mjs --calls
```

- [ ] Verify two devices on distinct real networks with trusted TLS, advertised addresses,
  and working media ports. Confirm voice and video in both directions, device switching,
  Wi-Fi or cellular reconnect, and a selected relay candidate in a TURN fallback case.
  Record versions, networks, browser/OS, observed token behavior, and results. Keep network
  acceptance open if only automated local devices were available. [Deployment][deployment]
- [ ] Review the diff against the approved spec and AGENTS.md. Commit
  `test(calls): verify connected calls and runtime isolation`. Document profile setup,
  network prerequisites, token lifetime observations, and repeatable verification in the
  owning documents. Mark the roadmap when its exit gate passes. Commit
  `docs(calls): describe deployment and call lifecycle`.

[spec]: ../specs/2026-11-12-m9-livekit-calls-design.md
[product]: ../specs/2026-11-08-complete-product-design.md#11-one-to-one-calls-using-livekit
[roadmap]: 2026-11-08-product-milestones.md#m9-independent-one-to-one-livekit-calls
[server]: https://github.com/livekit/livekit/releases/tag/v1.13.11
[rust-sdk]: https://github.com/livekit/rust-sdks/releases/tag/livekit-api%2Fv0.10.1
[browser-sdk]: https://github.com/livekit/client-sdk-js/releases/tag/v2.24.0
[room-issue]: https://github.com/livekit/livekit/issues/4972
[deployment]: https://docs.livekit.io/transport/self-hosting/deployment/
