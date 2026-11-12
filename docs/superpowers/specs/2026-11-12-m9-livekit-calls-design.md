# M9 one-to-one voice and video calls

## Outcome and approach

Connected users can place a voice or video call from an existing direct conversation.
Online recipient sessions ring, and the first session to answer takes the call. A user
who returns after an unanswered call sees a missed-call record in the conversation.
The [roadmap][roadmap] and [product design][product] define the milestone boundary.
Group calls, screen sharing, recording, end-to-end encryption, and closed-browser
wakeup are outside M9.

Use a small Rust call module for invitations, access, and lifecycle. LiveKit owns media
transport, track management, and media reconnection through its official SDKs. PostgreSQL
stores authoritative call state. Centrifugo wakes connected clients to fetch it. Worker
jobs create, inspect, and remove LiveKit rooms outside business transactions.

A room-first flow would have fewer application states, but it would need separate rules
for ringing, privacy, missed calls, and competing accepts. The selected app-owned flow
uses Telegram's request, first-device answer, and discard pattern with LiveKit supplying
the media layer. Creating the room after acceptance keeps unanswered calls out of LiveKit.
[Telegram call flow][telegram]

## Admission and ringing

Expose voice and video actions in the connected direct chat header when calls are configured.
The start command targets an existing, currently authorized direct conversation. It cannot
create a conversation, start from a contact profile, or target Saved Messages or a community.
The API checks the caller's current session, both account states, conversation access and
quarantine, and blocks in both directions. Apply the recipient's independent call audience.
Under the contacts policy, the recipient must have saved the caller.

Persist a call with its ID, conversation, parties, requested media mode, initiating session,
state, and deadlines. Reserve one slot for each account atomically in stable lock order.
Bound attempts and deployment-wide concurrent calls on the server. Cross-calls compete for
the same slots, so only one reaches ringing. A rejected admission creates no history event
and reveals no recipient session or device details. Give mutating commands replay-safe
operation IDs and return current authorized state for stale commands.

The authenticated call snapshot exposes pending calls to the recipient's eligible online
sessions. Reuse the personal Centrifugo channel for content-free hints and use bounded
snapshot refresh on reconnect, focus, and polling fallback. A hint grants no media access.
The connected workspace owns the incoming call UI, so switching to settings or another chat
does not dismiss it. Tabs sharing one browser session coordinate ringing and media ownership.
Leave incoming calls outside M8 Web Push. Snapshots stop showing a ring at its database
deadline, even if the timeout job is delayed. A returning session reads the missed-call
record through ordinary chat history.

## State and media

- **Ringing.** The recipient can answer or decline. The caller can cancel. Expiry ends as missed.
- **Connecting.** One recipient session won acceptance. The Worker prepares the room and the
  designated sessions join. Setup has a deadline.
- **Active.** Both designated participants have established media. A temporary departure
  starts a bounded reconnect grace period.
- **Ended.** The server records the reason and timestamps, releases slots, and schedules cleanup.

Accept, decline, cancel, and timeout serialize on the same call. The first valid acceptance
records the accepting session and stops ringing on the other devices. After acceptance,
only the initiating and accepting sessions can control the live call. Other sessions see
that ringing has ended. Recheck admission policy at acceptance. Later block, suspension,
deletion, designated session revocation or expiry, and direct-conversation quarantine
terminate an accepted call. A pending call ends when the initiating session or either
account becomes ineligible. Revoking another recipient session only stops its ringing.

Assign each call a fresh unguessable room name. A leased Worker job creates the room with
a two-participant limit. Persist the room identity before enabling credential requests.
The API issues short-lived, room-scoped join credentials only to the designated sessions
after checking current authority, room readiness, and deadlines. Participant identities
are assigned by the server. Grants allow subscribing and publishing microphone and camera
tracks. Keep room administration, data publishing, and other track sources outside client
grants. Keep credentials out of history, wakeups, persistent browser storage, and logs.

Use explicit user actions for microphone and camera access. Video calls ask for the camera;
voice calls start with the camera off. Either party may explicitly enable video during a
voice call, and the peer sees the published track. Provide mute, camera toggle, device
selection, and hangup. If required initial media permission fails, show the reason and
end the call. If optional video activation fails during a call, keep the audio session
running and show the camera error.

Use LiveKit SDK events for immediate connecting and reconnecting feedback. A refresh or
short network loss can resume the same call from the same authorized session within the
grace window. Other sessions cannot take over. Keep the call active during that window.
Only observed media recovery clears the departure deadline. A missed setup or reconnect
deadline terminates the call with a readable failure reason.

## Termination and recovery

PostgreSQL is the authority for call state, deadlines, and eligibility. Use the existing
conversation, account, and session lock order. Mutations that already hold account or
session locks can persist a termination intent in their own transaction and let a Worker
apply the call transition under the canonical lock order. Recheck those policy changes
before issuing any join credentials, including while termination is pending.

Verify LiveKit webhook signatures against the original request body and deduplicate by
event ID. Match observations to the expected room and designated participant. An old
departure must not override a confirmed newer connection. Reconcile uncertain or missing
events with LiveKit's room service. Fence Worker acknowledgements and room observations
against the current call state and room identity. If a room creation finishes after the
call ends, schedule removal of that room. Delayed observations cannot revive a terminal call.

The terminal transition records the outcome once, releases slots, and commits durable
intents for room cleanup and one history event. Use the call ID as the history event's
deduplication identity and publish it through ordinary message sync. Render a compact call
record with the type and outcome, with duration for established calls. History visibility
follows the existing direct conversation rules. A retry or restart cannot duplicate the
record. Service events are distinct from ordinary user sends and do not trigger new-call
ringing or message Push. An unavailable history or media service cannot keep a slot occupied.

Disable room auto-creation in the self-hosted profile and explicitly delete ended rooms.
An issued JWT can remain valid after removal, and LiveKit can refresh it during a connection.
Keep the provider's signaling port private. The application gateway verifies the room
credential and checks current call state on every new connection. Termination closes this
admission path before cleanup, and room names are never reused. Verify rejection at the
gateway and measure how long already admitted media stays connected during cleanup.
[LiveKit token lifecycle][livekit-tokens] and [room configuration][livekit-config]

## Deployment and acceptance

Provide an optional LiveKit and TURN Compose profile. Leave ordinary chat available when
calls are disabled or LiveKit fails. Calls fail with a recoverable error if setup or media
service recovery exceeds its deadline. When PostgreSQL is unavailable, new calls and new
credentials fail closed. Existing media can continue until disconnection or cleanup, and
reconciliation resumes after recovery.

- Exercise default contacts-only admission, call audience, blocks, quarantine, slot limits,
  simultaneous cross-calls, duplicate commands, and cancel versus accept.
- Ring two recipient sessions and race their accepts. Only the winning session gets
  credentials. Confirm that an unanswered call leaves one missed record after reopening.
- Exercise microphone and camera refusal, device selection, mute, adding video, refresh,
  reconnect expiry, and termination on session or account invalidation.
- Exercise delayed, duplicate, and missing webhooks, Worker restart during room creation
  or deletion, stale initial and refreshed tokens, and one terminal record after retries.
- Verify audio and video across two real networks, including a TURN fallback, with the
  chosen public media addresses, ports, and TLS configuration. Exercise LiveKit interruption
  while normal messaging continues. Use automated browsers for lifecycle coverage and
  physical devices for microphone, camera, and network acceptance.

Choose wire contracts, bounded timing values, job capacities, and pinned SDK and server
versions in the implementation plan.

[roadmap]: ../plans/2026-11-08-product-milestones.md#m9-independent-one-to-one-livekit-calls
[product]: 2026-11-08-complete-product-design.md#11-one-to-one-calls-using-livekit
[telegram]: https://core.telegram.org/api/calls
[livekit-tokens]: https://docs.livekit.io/frontends/reference/tokens-grants/#token-lifecycle
[livekit-config]: https://github.com/livekit/livekit/blob/master/config-sample.yaml
