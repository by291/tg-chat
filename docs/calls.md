# One-to-one calls

The optional LiveKit profile adds voice and video to existing direct conversations.
PostgreSQL owns call state, eligibility, deadlines, and history. LiveKit carries media.
The ordinary messaging runtime can start with calls disabled and keeps working during a
provider outage.

## Admission and ringing

Start a call from an existing direct chat. The API checks current conversation access,
both accounts, blocks in either direction, and the recipient's call audience. Under the
contacts-only policy, the recipient must have saved the caller. Admission reserves one live
slot per account in the same transaction. Simultaneous cross-calls contend for those slots,
and rejected starts do not create history. Mutating commands use replay-safe operation IDs.

Eligible connected recipient sessions can ring. The first valid accept designates one
recipient session and ends ringing elsewhere. After acceptance, only that session and the
initiating session control the live call and can obtain media credentials. Centrifugo sends
private refresh hints. The authenticated workspace rechecks current state on reconnect,
focus, or a polling fallback. A hint carries no media authority. Browser call controls
require a secure context, media capture, WebRTC, and Web Locks. Tabs sharing one session
use a Web Lock to coordinate ownership of the call.

## Media and reconnect

The Worker creates a fresh two-participant room after acceptance. The API grants only the
designated sessions short-lived, room-scoped credentials for subscribing and publishing
microphone or camera tracks. The application gateway rechecks current authorization on
every new signaling connection. Keep credentials out of durable browser storage, history,
hints, and logs. See [deployment and network configuration](./operations.md#livekit-calls).

The browser requests devices on explicit call actions. Voice starts with the camera off,
and either participant can enable video during the call. Denial of required initial media
ends setup. Failure to enable optional video leaves the audio session running. The browser
releases devices when the call ends or it loses media ownership.

The call moves from ringing through connecting to active after both participants have
established media. Database deadlines bound ringing, setup, and reconnect. An authorized
session can resume after a refresh or brief interruption within the grace period. Only an
observed recovery clears the departure deadline. The Worker verifies and deduplicates
signed webhooks and reconciles missing or uncertain observations against current room state.
Room and observation fences prevent a delayed leave from replacing a newer connection.

## Termination and history

Cancel, decline, hangup, timeout, and access loss can end a call. Policy changes such as
blocking, suspension, quarantine, and designated-session revocation fence media access
before Worker cleanup. Revoking a recipient session that did not accept leaves the
designated session's call intact.

The terminal transaction releases both slots and schedules independent room cleanup and
history work. Late room creation is cleaned up, and delayed observations cannot revive
the call. The history job uses the call ID to deduplicate publication through ordinary
message sync. One service record shows the outcome and, for an established call, its
duration. An unanswered call appears as missed after the browser reopens. Incoming
ringing is limited to connected sessions, and the history record does not trigger Push.

See [call verification](./development.md#call-verification) for repeatable service checks
and the [cross-network acceptance plan][network-acceptance] for the remaining device work.

[network-acceptance]: ./superpowers/plans/2026-11-12-m9-livekit-calls.md
