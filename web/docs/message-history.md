# Messages and history

## Separate message identity, content, and presentation

A message has a stable identity and explicit content types. Shared bubble chrome owns sender
context, reply/forward information, metadata, reactions, and actions. Content renderers handle
text, media, polls, and other message bodies without turning the bubble into a collection of
unrelated flags.

Identity belongs to the message or media occurrence, not its current DOM node or source URL.
Virtual rows can unmount and return, and an album can contain the same image more than once.
Replies, selection, gallery navigation, and playback must still refer to the intended occurrence.

Rich content retains a searchable plain-text representation alongside sanitized formatting.
Search and previews therefore do not need to instantiate an editor or inspect rendered HTML.
The composition boundary is described in [editing and interactions](./editing-and-interactions.md).

## Separate available history from mounted rows

History availability answers which messages can be reached. Virtualization answers which rows
need DOM nodes now. These are different windows: a distant reply can require older data without
requiring every intervening message to mount.

The local implementation already holds conversation data in memory and exposes earlier history
progressively. TanStack Virtual owns row measurements and the bounded rendering window. A backend
can replace the history source later without taking ownership of DOM geometry.

Grouping and date boundaries derive from the message sequence, rather than from whichever rows
happen to be mounted. Service messages interrupt groups, and paged boundaries retain the correct
sender and day context. Date headers use the measured day regions and native sticky positioning.

## Scrolling preserves the reader's intent

The history coordinator distinguishes user scrolling, an explicit navigation request, and a layout
change. Letting each independently set scroll position would cause jumps and competing corrections.

Incoming messages follow the end only when the reader is already near it. Sending or choosing the
latest-message action is an explicit request to return to the end. Reading older content should
survive prepends, deletions, and responsive layout changes.

A reading anchor consists of a stable message identity and its offset in the viewport. Width changes
can alter text wrapping and invalidate row heights, so the previous anchor is captured before
remeasurement and restored after layout settles. Composer growth preserves bottom following only
for a reader who was already at the end. New user input cancels obsolete correction work.

Floating headers and composition controls occupy part of the visible history area. Their measured
insets inform navigation and bottom spacing, so targets remain visible without shrinking the
scrollable wallpaper surface or placing the last message behind the composer.

## Navigate by identity before using geometry

Reply, search, calendar, and pin actions request a message identity. Navigation first makes the
target available, then mounts and measures its neighborhood. It never assumes that a target DOM
node already exists.

A distant jump retains bounded ranges around the current view and destination instead of mounting
the entire gap. The navigation owner coordinates movement, temporary ranges, and cancellation.
Automatic older-history loading pauses while explicit navigation or width rebuilding owns the
viewport; normal user scrolling can resume prefetching afterward.

Search results and pinned-message views reuse message rendering and navigation rather than
maintaining separate bubble implementations. Their overlays preserve the underlying conversation
and composer state, so returning to the conversation does not lose the user's work.

## Reserve geometry and coordinate media work

Media dimensions are known before decoding where possible. The initial estimate and final renderer
use the same geometry rules, preventing decoded images from unexpectedly changing the reading
position. Existing images stay visible while heavy source loading is deferred during navigation.

Virtual position and message animation are separate concerns. Returning rows do not replay arrival
animations. Audible playback shares one arbiter, while muted previews and decorative animations
follow visibility and playback preferences. Leaving the viewport or unmounting releases playback.

Ordinary visual interpolation uses Motion or CSS without storing every animation frame in React
state. Message flights and history scrolling retain dedicated geometry owners because they must
coordinate measured layout, interruption, and completion. Reduced motion preserves the final
state and navigation result.

See [architecture](./architecture.md) for durable state and backend boundaries, and
[development](./development.md) for validation.

## Connected remote history

The connected owner retains a bounded sequence window. On entry the server can center the page
on the first visible unread message and the timeline places a divider before it. The divider
stays in place while the reader's cursor advances. Scrolling toward either loaded edge requests
the next page and keeps the visible anchor. The floating arrow returns to the server's latest
window when newer pages remain. The same TanStack Virtual measurements and preceding-message
projection preserve the reading position and sender grouping.

A pending message keeps its client UUID when accepted, preventing an optimistic row from becoming a
second canonical row. Connected metadata distinguishes queued/sending/failed states from server
acceptance. A failed text bubble offers retry using its original identity. The acceptance
indicator makes no device-delivery claim, and the peer's read cursor separately controls the read
indicator. Foreground read advancement uses the visible incoming message actually reached.
The sender can see the exact read time of an eligible private message in its menu when permitted by
the reader's online status privacy setting. The conversation row menu can also explicitly mark the
known history as read without opening the chat.

The chat header previews the latest accessible pin and can jump to it or open the pin list.
Touch users can swipe a message to reply. A vertical scroll keeps its normal behavior.
Connected lifecycle controls use authoritative commands and retain editor text when an
expected-version edit conflicts.

Reply jumps can request an authorized bounded neighborhood outside the loaded window. Pins have a
separate paginated directory. Hidden, deleted, cleared, or expired targets remove obsolete excerpts;
late pages and command receipts must pass the cache's observation/generation fences before merging.
The server enforces expiry independently of cleanup, and a local deadline removes visible expired
rows even during a network outage. Connected attachments retain their occurrence IDs and validated
geometry across pending, accepted, and viewer states. Signed URLs are requested through the current
message or avatar reference and stay outside the durable cache. See
[private media](../../docs/media.md) for upload and download ownership.
