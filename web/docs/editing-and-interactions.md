# Editing and interactions

## Keep composition and editing responsibilities distinct

The composer owns the message being prepared: draft context, replies, pending forwarding,
attachments, and submission. Lexical owns editable content, selection, composition events, and undo.
This prevents editor mechanics from becoming conversation business rules.

Sending produces one message command; the conversation layer assigns identity and applies the
state change. IME composition must finish before Enter can submit. Switching conversations restores
the corresponding draft, while editing a different message resets only the relevant edit context.
Sticker sending does not consume an unrelated text draft.

The persisted representation is plain text, optional sanitized semantic HTML, and UTF-16 custom
emoji ranges. Lexical state is an editing detail rather than the storage format. This lets messages,
previews, search, and future transports consume content independently of the editor implementation.

Conversion preserves alignment between plain text and custom emoji across blocks, lists, and
tables. Formatting-only edits remain meaningful even when plain text is unchanged. Sanitization
rejects unsafe markup and link protocols before content is stored or rendered; interactive content
is rendered through application components rather than executed from saved HTML.

In connected chats, a link in the draft can show a compact preview above the editor. The composer
looks up only the candidate URL and discards a response if its link or edit context changes.
Removing the preview keeps the draft intact and carries the sender's preference with the send or
edit. Restoring the preview reverses that preference without requiring a text change.

## Selection and focus follow the user's action

Formatting dialogs temporarily take focus without losing the editor selection. Applying or
cancelling restores the selection needed for the next editing action. The editor keeps one shared
selection owner; external draft replacement must not remount it or publish the previous draft again.

Ark UI provides menu, dialog, popover, and keyboard interaction contracts. The application decides
which surface should receive focus after a command. Returning focus from a closing menu must not
race with opening a composer, search field, or another dialog.

Retained panels separate visibility from lifetime. Closing content stays mounted for its exit,
while inactive surfaces cannot receive input. Search focus waits for the destination panel to be
ready. Virtual search and calendar navigation reveal an offscreen target before moving focus to it.

## Asynchronous attachments keep request ownership

One attachment owner handles file input, paste, drop, decoding, and previews. Choosing another
file, removing it, submitting, or unmounting invalidates the previous request. A decoder completing
later must not restore stale content or overwrite a newer selection.

Attachment previews are temporary composition state. Their lifetime is deliberately different
from persisted text drafts and sent media. This distinction keeps cancellation predictable and
avoids turning every unfinished file choice into a storage operation.

## Message actions share one interaction model

Pointer, keyboard, and touch entry points reach the same message commands. Ordinary text selection
and interactive children retain their native behavior. Selection gestures use the surrounding row
surface, so selecting text or operating a video control does not accidentally select messages.

Selection is stored as message identities, independent of the mounted virtual rows. Bulk deletion
and forwarding become batch domain actions. The composer stays mounted while the selection toolbar
is shown, preserving unfinished input.

Reporting starts from a message, a selection of eligible messages, or the community menu. The
community entry opens a dedicated selection in the current history. The dialog collects a reason
and an optional note, then submits each selected message as its own case. A partial retry
keeps each failed request's identity and leaves accepted reports out of the retry.

Pending forwarding lives above the conversation pane so changing destinations does not discard it.
Forwarding creates new message identities and applies destination rules without consuming the
recipient's existing text draft. It does not blindly copy source reactions, pins, or expiration.

The history view shares a menu controller instead of attaching a complete menu to every row.
Scrolling or losing the target closes that menu; focus restoration respects any command that
intentionally transfers focus elsewhere.

## Sorting is an explicit operation

Pinned conversations and form rows expose drag handles. Selecting a conversation remains an
ordinary immediate action. dnd-kit recognizes sorting, while the application owns the committed
identity order. Virtual rows keep their DOM ownership, and offscreen pinned items remain part of
the ordering model.

Only a valid drop changes order. Escape cancels sorting without closing its containing form or
committing a partial result. Keyboard sorting follows the same rules and restores useful focus.

## Viewer gestures have one transform owner

use-gesture recognizes drag and pinch input. The viewer retains responsibility for anchored zoom,
rotated bounds, wheel policy, momentum, and navigation decisions. Pointer and wheel adapters feed
one transform owner rather than maintaining competing positions.

When a pinch ends with one finger still down, that pointer can continue panning. A new pinch or
window blur cancels the previous continuation. Nested controls remain outside gesture ownership,
so seeking, changing volume, or pressing a button does not also move the image.

## Forms separate validation from serialized messages

React Hook Form owns poll/checklist field state and editable row arrays. Zod validates required
content, duplicate entries, limits, and dependent answers. Sorting changes the field order while
preserving the identity of each entry and its associated state.

Validation and submission guards live at the form boundary. The resulting domain message does not
depend on the form library's internal representation. Local permissions and participation remain
frontend behavior until a backend supplies authoritative rules.

See [architecture](./architecture.md) for state lifetime and
[messages and history](./message-history.md) for rendering and scroll ownership.
