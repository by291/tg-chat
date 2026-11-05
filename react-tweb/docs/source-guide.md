# Reading the React Conversation Implementation

## Start with the ownership chain

Read these files in order:

1. `src/main.tsx` mounts React and the global design tokens.
2. `src/chat/ChatApp.tsx` owns the selected conversation, page layout, and secondary panels.
3. `src/chat/useChatState.ts` restores IndexedDB before interaction and persists reducer snapshots.
4. `src/chat/model.ts` defines the message shape, actions, and persisted-data validation.
5. `src/chat/reducer.ts` makes the permanent state transitions explicit.
6. `src/chat/ConversationPane.tsx` translates user commands into those actions.
7. `src/chat/MessageTimeline.tsx` owns scrolling and sender grouping.
8. `src/chat/MessageBubble.tsx` renders a message and its Ark UI action menu.
9. `src/chat/MessageComposer.tsx` owns editing, image preparation, and submission.

There is one conversation feature directory. The only shared components are `Avatar` and
`IconButton`, both used by several parts of the interface. State has not been hidden behind a
generic controller or a custom event bus.

## Follow one send

The composer receives a draft and reports edits through `onDraftChange`. The conversation pane
dispatches `set-draft` with a chat ID. On Enter, `shouldSubmitMessage` checks Shift and IME state
before the composer reports a `ComposedMessage`.

The conversation pane creates the message ID and timestamp, attaches the current reply reference,
and dispatches `send`. The reducer appends the message and clears only that chat's text draft.
Sending a sticker preserves the separate text draft. React renders the new message; the timeline
follows a new outgoing message to the bottom; the persistence hook writes the updated snapshot.

## Keep permanent and temporary state separate

Messages, drafts, selected chat, and appearance live in the reducer. Open menus, active search,
the editing target, reply target, delete confirmation, and photo viewer are temporary UI state.
The conversation pane is keyed by conversation ID, so a reply or edit cannot leak into another chat.
The composer is keyed by the editing message ID, so changing the edit target resets its editing text.

Only validated saved data reaches rendering. Timestamps must be inside JavaScript's valid Date
range. A failed read leaves the initial demonstration usable; a failed write produces a visible
storage notice. One tab is the supported editing owner; cross-tab reconciliation is not implemented.

## Why the timeline owns scrolling

The scroll container is stable while its messages change. A new outgoing message moves to the
bottom, while edits and reactions preserve the reader's current position. A `ResizeObserver`
keeps the latest message above an expanding composer when the reader is already near the bottom.
Reply navigation scrolls to the stable message ID and briefly highlights it.

Image dimensions are decoded before sending and stored with the image. The browser reserves the
aspect ratio during rendering, which avoids a late image decode moving the rest of the history.
Each image selection has a request ID: only the newest pending decode may change the preview or
loading state. Cancelling invalidates that ownership.

## What Ark UI does

The headless components provide interaction contracts without imposing a visual theme.

- `Menu.Root` owns selection. Message commands use its `onSelect` event; quick reactions are
  actual menu items so keyboard navigation reaches them too.
- `Popover` positions the emoji palette and handles dismissal.
- `Dialog` manages the media viewer and delete confirmation, including focus trapping and Escape.
- `Tabs` coordinates the emoji/sticker and members/media panels.

CSS Modules style those components using their semantic data attributes. The React code does not
manually position menus, maintain document-level dismissal listeners, or implement a focus trap.

Official component references:
[Menu](https://ark-ui.com/docs/components/menu),
[Popover](https://ark-ui.com/docs/components/popover),
[Dialog](https://ark-ui.com/docs/components/dialog).

## Compare with the local tweb reference

The reference checkout used during development was `/Users/by291/code/js/tweb`.
The hosted conversation was observed on November 5, 2026. This checkout and the hosted application
may diverge in later revisions; the table is a reading map, not a claim that every upstream feature
has been ported.

| Original tweb source                    | Responsibility                       | React counterpart                        |
| --------------------------------------- | ------------------------------------ | ---------------------------------------- |
| `src/components/chat/chat.ts`           | Conversation coordination            | `ConversationPane.tsx`                   |
| `src/components/chat/bubbles.ts`        | Message DOM and history ownership    | `MessageTimeline.tsx`                    |
| `src/components/chat/input.ts`          | Composer and send flow               | `MessageComposer.tsx`                    |
| `src/scss/partials/_chatVariables.scss` | Bubble geometry and composer timing  | CSS Modules and `global.css`             |
| `src/scss/partials/_chatTopbar.scss`    | Floating toolbar and pinned plates   | `ChatHeader.module.css`                  |
| `src/scss/partials/_chat.scss`          | Centering, history, and input layout | `ChatApp.module.css` and timeline styles |
| `src/scss/partials/_chatBubble.scss`    | Bubble states and media presentation | `MessageBubble.module.css`               |
| `public/assets/img/pattern.svg`         | Wallpaper artwork                    | `public/assets/telegram-pattern.svg`     |

Observed geometry includes a 360px floating sidebar, a centered 696px conversation, a 48px toolbar
and composer, and 16px outer spacing. Upstream bubble values include 15px and 5px radii, 2px spacing
within a sender group, and 4px/5px/8px text padding. This study uses 200ms message/composer motion
and 280ms sidebar layout transitions. It approximates the visible animation; it does not reproduce
Telegram's full send morph, sticker player, or history animation scheduler.

## Tests worth reading

`reducer.test.ts` follows user-visible state changes rather than asserting private function calls.
`ConversationPane.test.tsx` drives real Ark menus with a keyboard and saves an edit.
`MessageComposer.test.tsx` controls the asynchronous image decoder boundary to reproduce completion
out of order. `composerKeyboard.test.ts` protects input-method composition. `storage.test.ts`
rejects malformed saved state and out-of-range timestamps before rendering.

## Extending the study

For a larger local history, introduce a measured virtual timeline while keeping scroll ownership in
one place. For real Telegram connectivity, add a transport boundary and reconcile server IDs with
stable local IDs. Keep that work separate from the presentation components so the local study can
continue running without credentials or a network connection.
