# Reading the React Conversation Implementation

## Start with the ownership chain

Read these files in order:

1. `src/main.tsx` mounts React and the global design tokens.
2. `src/app/ChatApp.tsx` owns the selected conversation, page layout, and secondary panels.
3. `src/chat/state/useChatState.ts` restores IndexedDB before interaction and persists reducer snapshots.
4. `src/chat/model.ts` defines the message shape, actions, and persisted-data validation.
5. `src/chat/state/reducer.ts` makes the permanent state transitions explicit.
6. `src/chat/ConversationPane.tsx` translates user commands into those actions.
7. `src/chat/history/MessageTimeline.tsx` owns scrolling and sender grouping.
8. `src/chat/messages/MessageBubble.tsx` renders a message and its Ark UI action menu.
9. `src/chat/composer/MessageComposer.tsx` owns editing, image preparation, and submission.

## Directory layout

This Vite application uses a small application shell, reusable presentation components, and a
chat module with colocated implementation files. React does not prescribe one directory template;
its [file structure guide](https://legacy.reactjs.org/docs/faq-structure.html) describes grouping
by feature, grouping by file type, and mixing them as a project grows. Here the grouping follows
the parts of the conversation that are read and changed together.

| Directory            | Responsibility                                                               |
| -------------------- | ---------------------------------------------------------------------------- |
| `src/app/`           | Application layout, selected chat, transient panels, and notices             |
| `src/components/`    | Reusable avatars, icon buttons, and press ripples                            |
| `src/chat/`          | Conversation orchestration, header, delete dialog, and common chat contracts |
| `src/chat/composer/` | Draft input, keyboard behavior, emoji picker, and attachment preparation     |
| `src/chat/history/`  | Timeline rendering, virtual measurements, paging, and scroll anchoring       |
| `src/chat/messages/` | Bubble shell, metadata, tails, content renderers, and playback visibility    |
| `src/chat/media/`    | Photo gallery, viewer navigation, and media geometry                         |
| `src/chat/sidebar/`  | Conversation rows, account menu, and local search transitions                |
| `src/chat/details/`  | Chat information and shared-photo panel                                      |
| `src/chat/state/`    | Reducer transitions, poll voting, persistence, and state restoration         |
| `src/chat/demo/`     | Initial conversations, archive fixtures, and the message showcase            |

Components keep their CSS Modules nearby. Unit and component tests remain beside the behavior
they exercise. `src/main.tsx` is the Vite entry, and `src/global.css` owns global tokens and resets.
`ConversationPane.module.css` belongs to the conversation itself; the pane does not import styles
from the application shell.

The chat-wide model, media schemas, formatting functions, and overlay styles stay at the chat
root because several chat areas use them. This is a single chat application, so an additional
`features` directory, router-only `pages` directory, and global `hooks` registry would add little.

Imports name their owning module directly. For example, history renders `messages/MessageBubble`,
while both message rendering and history estimation use `media/mediaGeometry`. The details panel
uses the same photo-gallery functions as the viewer. These dependencies are intentional; they do
not require routing business code through a generic shared layer. The reusable components have no
chat dependencies, and the state layer does not import rendered components.

There are no new dependencies or barrel exports. Runtime state, IndexedDB keys, and public asset
URLs are unchanged by the reorganization. Earlier implementation plans record the original layout;
this guide is the current source map.

## Follow one send

The composer receives a draft and reports edits through `onDraftChange`. The conversation pane
dispatches `set-draft` with a chat ID. On Enter, `shouldSubmitMessage` checks Shift and IME state
before the composer reports a `ComposedMessage`.

The conversation pane creates the message ID and timestamp, attaches the current reply reference,
and dispatches `send`. The reducer appends the message and clears only that chat's text draft.
Sending a sticker preserves the separate text draft. React renders the new message; the timeline
follows a new outgoing message to the bottom; the persistence hook writes the updated snapshot.

## Keep permanent and temporary state separate

Messages, drafts, selected chat, conversation preferences, and appearance live in the reducer.
Open menus, active search,
the editing target, reply target, delete confirmation, and photo viewer are temporary UI state.
The conversation pane is keyed by conversation ID, so a reply or edit cannot leak into another chat.
The composer is keyed by the editing message ID, so changing the edit target resets its editing text.

Only validated saved data reaches rendering. Timestamps must be inside JavaScript's valid Date
range. A failed read leaves the initial demonstration usable; a failed write produces a visible
storage notice. One tab is the supported editing owner; cross-tab reconciliation is not implemented.

For sidebar actions, read `sidebar/ConversationMenu.tsx`, `sidebar/useSidebarActions.ts`, and
`state/conversationActions.ts`. The menu names available commands, the hook owns selection and
confirmation dialogs, and reducer helpers persist the actual changes. `sidebar/conversationList.ts`
combines fixture defaults with saved preferences, resolves mute deadlines, and orders pinned chats.
`sidebar/VirtualConversationList.tsx` owns the fixed-height sidebar window and pinned drag order.
`sidebar/SidebarNavigation.tsx` moves whole sidebar pages with Telegram's forward/back transitions;
the inbox and archive retain independent scroll positions. `SidebarPageHeader` shares the selection
overlay behavior between their headers.
`sidebar/ConversationPreview.tsx` positions a read-only instance of the existing message timeline;
it does not maintain a second set of bubble renderers. See the
[sidebar audit](./sidebar-style-audit.md) for upstream menu and list-virtualization references.

## Virtual history and scrolling ownership

Read `historyRows.ts`, `useHistoryWindow.ts`, `useVirtualHistory.ts`, and `historyAnchor.ts` after
`MessageTimeline.tsx`. Each has a separate responsibility:

- `historyRows.ts` derives dates and sender groups from the complete message sequence.
- `useHistoryWindow.ts` starts with 60 rows and exposes 80 earlier rows near the loaded boundary.
- `useVirtualHistory.ts` connects TanStack Virtual with eight overscan rows, stable keys,
  `anchorTo: 'end'`, and `followOnAppend`. Wheel, touch, and keyboard gestures cancel active jumps.
- `historyAnchor.ts` preserves the visible key and row-relative offset when the viewport width
  invalidates cached text wrapping. It uses the virtualizer's scroll API for restoration.

Data availability and mounted DOM are different windows. A distant reply may expose all 1,000
local archive messages, while only the visible rows and overscan are mounted. The current local
repository keeps all messages in memory. A future transport can replace this availability layer
without taking ownership of DOM measurements.

New incoming content follows only when within 80px of the bottom. An explicit send returns to the
latest message. Deleting the last message is not treated as an append. ID navigation expands the
available window before calling `scrollToIndex`; it never assumes the target DOM already exists.
Search filters rendered rows but retains a lookup of the complete conversation for reply previews.

Width changes are different from prepends. `measure()` invalidates cached heights but does not
itself preserve a reading key. The latest stable reading anchor is captured before width changes,
because child ResizeObserver notifications can precede the viewport notification. After measuring
mounted rows at their new width, the same key and offset are restored. Composer-height changes
retain bottom following only if the reader was already at the end.

Virtual rows are positioned separately from their bubble animations. Initial messages and rows
returning from offscreen do not replay entry animations. Audio and video pause when their message
leaves the viewport; unmounting also disposes playback.

The local reference uses the same library in
`/Users/by291/devel/js/virtual-demo/src/hooks/useVirtualChat.ts` and
`src/lib/mediaBox.ts`. Its fixed-frame initial settling is replaced here with a cancellable
post-commit scroll that also survives React Strict Mode's effect remount.

Official references: [chat guide](https://tanstack.com/virtual/latest/docs/chat) and
[virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer).

## A bubble shell with distinct content

See [the bubble style audit](./bubble-style-audit.md) for source-backed dimensions, verification,
and the remaining visual differences. The presence of a renderer does not mean complete parity.

`MessageBubble.tsx` owns sender grouping, avatars, forward/reply headers, metadata, reactions,
and context commands. `MessageBody.tsx` selects explicit renderers from the discriminated media
schema in `messageMedia.ts`. It does not spread unrelated media flags through a giant renderer.

- `MessageMediaFrames.tsx`: photo, album, regular video, and circular video frames.
- `VoiceMessage.tsx`: actual audio playback, waveform progress, and seeking.
- `MessageCards.tsx`: downloadable files, link previews, and telephone contacts.
- `PollMessage.tsx` and `pollVoting.ts`: displayed results and persistent local vote replacement.
- `photoGallery.ts`: unique gallery identity for every album tile, even duplicate source images.

Photo and video geometry is reserved before decoding. `mediaGeometry.ts` follows tweb's 420 by 400
regular box, 200px minimum side, 120px photo minimum width, 368px video minimum width, and 320px
caption width. It is shared with the initial row estimator. A narrow viewport scales the reserved
frame; late image decoding does not introduce a new intrinsic size.

Pure visual media places the timestamp over its frame. Captions put metadata in the text flow.
Stickers and circular video use transparent shells. Service rows interrupt sender groups; date
identity uses the full local calendar date, including its year.

Existing version-1 snapshots upgrade once by adding the Message lab conversation. Existing edits,
deletions, drafts, and photo metadata remain intact; version-2 restores do not reseed deleted lab
messages. All writes continue using the existing IndexedDB key.

## What Ark UI does

`ChatHeader.tsx` follows the measured Web K toolbar geometry: a 48px plate with a 24px radius,
40px avatar, 16px avatar-to-title gap, 16px title, 14px subtitle, and 40px utility buttons separated
by 4px. On the existing mobile breakpoint, search moves into the More menu. Calls remain outside
the local demo's scope.

`PinnedMessageBar.tsx` owns the separate 48px pinned plate, its 8px top gap, 3px accent border,
14px title and summary, optional 40px media thumbnail, pin menu, and unpin confirmation. It follows
`_chatPinned.scss` and `components/chat/pinnedMessage.tsx`. Clicking cycles through local pins and
jumps through the existing history navigation. The pin list reuses `MessageTimeline`, with separate
message DOM IDs; the ordinary history and composer stay mounted while that list is open.

`PinnedMessageIndicator.tsx` follows `pinnedMessageBorder.ts`: 3px width, a 40px viewport,
40/19/12/10px segment heights, and a 250ms moving track and highlight. More than four pins enable
6px edge fades. The two- and three-pin offsets retain the upstream geometry rather than dividing
the available height evenly.

`PinnedMessagePreview.tsx` follows `AnimatedSuper`, `AnimatedCounter`, and `_chatPinned.scss`.
The title stays still while old and new subtitles roll and crossfade over 200ms with ease-in-out.
Older pins enter from above; wrapping to the newest enters from below. Text and media travel 20px
and 40px respectively. The counter animates changed digits independently and scales to 0.68 while
fading out on the newest pin. Media scales out before its row is released; text shifts 46px when a
thumbnail is present. Motion retains outgoing rows through their exit, including interrupted
selections, and initial mounts stay still. Reduced motion retains crossfades without rolling.

Manual browser inspection used six temporary pins on a separate localhost origin, covering text,
media, middle-track fades, repeated selection, wrapping, and returning to a single pin. The temporary
pins were removed afterward. No tests were added or run. Selecting the pin preview from the visible
history position remains outside this implementation.

Message-ID navigation uses `history/animateHistoryNavigation.ts`, following tweb's
`helpers/fastSmoothScroll.ts`: 250–600ms by distance, at most 1500px of animated travel, and the
upstream power easing for short and long paths. Tall messages align their beginning; other targets
are centered. Distant navigation loads history, mounts and measures the bounded animation corridor,
positions near the destination, then animates. The temporary range is a union with the visible
rows, so it never mounts every row between distant endpoints. Wheel, touch, keyboard, and a newer
navigation request cancel the previous movement; reduced motion lands immediately.

The animation writes intermediate scroll positions directly, while TanStack owns measurements,
scroll observations, and final index reconciliation. Issuing a new `scrollToOffset` command on
every frame would repeatedly restart the virtualizer's command reconciliation. Stable history
arrays preserve its measurement cache. Memoized bubbles avoid rebuilding unchanged content during
range updates, and the shared message-menu contents mount only when opened.

The timeline itself is memoized, and its command callbacks and pin list retain their identities.
Draft edits still use the existing persistence flow, but do not rerender the unchanged history.
The appeared-message set is initialized lazily; the loaded-window start is recomputed only when
its inputs change. Navigation resolves its target index once per row revision, then reads current
measurements at that index instead of searching every animation frame.

Scroll events and virtualizer commits share one animation-frame task. Reading anchors come from
TanStack's measured rows and the scroll offset, including bottom alignment for short histories;
DOM measurement remains necessary when the available width changes. Responsive width changes
settle for 100ms before rebuilding, preserving the anchor from before the transition. A bounded
four-frame correction includes newly reported row sizes; user interaction or a newer navigation
cancels it. Anchor restoration applies its relative offset before clamping at the scroll boundary.

Navigation retains both the original mounted range and the destination corridor until completion
or cancellation. It does not mount the gap between distant ranges. Automatic history pagination
pauses during explicit message navigation and width rebuilding, but continues during user scrolling
and momentum. Approaching the start within one viewport (at least 360px) requests the next local page
before reaching the loaded boundary. Each boundary is requested once until the prepended rows commit;
TanStack's end anchoring preserves the current reading position. Scrolling toward newer messages
does not request older pages.
`messages/deferredMedia.tsx` postpones new photo, album, link-image, reply-thumbnail, and video-poster
sources during navigation. Existing images remain visible, frames retain their dimensions, and
media loading resumes after the temporary range is released. Audio and video already use
`preload="none"`. This coordination is local to the history view, not a global application lock.

`messages/MessageMenu.tsx` owns one Ark menu per history view. `useMessageMenu.ts` delegates pointer,
keyboard, and touch long-press entry points from the viewport. It uses a virtual anchor rectangle,
closes when the history scrolls or its target unmounts, and releases the target DOM reference after
exit. Escape returns focus to the message button; selecting Reply or Edit restores that focus
before the composer deliberately takes it. Preview histories do not mount a menu controller.

During the earlier navigation implementation, a local development-browser observation showed a frame gap
of 125ms before the final mounting optimizations. After them, the sampled intervals were mostly
about 8ms with a maximum near 25ms. These are local observations, not a general frame-rate guarantee.
Temporary frame logging was removed. The subsequent shared-menu and rendering changes were checked
manually for menu positioning, keyboard access, reply focus, retained drafts, long-distance navigation,
and width-change anchoring. They have not received a new frame-time benchmark. No automated tests
were added or run for these changes.

The archive entry and archive page header share `sidebar/ArchiveMenu.tsx`. Their commands live in
`sidebar/useArchiveActions.ts`; `ArchiveSettingsPage.tsx` owns the editable settings view and
`ArchiveDialogs.tsx` owns help and confirmation dialogs. `SidebarNavigation.tsx` keeps both pages
mounted while sliding between them, including the nested settings page. Archive preferences are
optional fields in the saved state, so existing snapshots continue to load. The reducer's `receive`
action in `state/incomingMessages.ts` applies the saved retention preference to local incoming
messages; a future transport can dispatch that action without putting archive rules in the UI.

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
and 300ms opening / 250ms closing profile transitions. It approximates the visible animation;
it does not reproduce
Telegram's full send morph, sticker player, or history animation scheduler.

## Topbar search, profile motion, and conversation actions

`ChatHeader` crossfades its title and actions into `ChatSearch` in 200ms, matching
`chat.ts` and `topbarSearch.tsx`. The avatar stays in place on desktop. Search keeps its query,
sender filter, and result cursor locally; it calls message-ID navigation rather than filtering
or remounting `MessageTimeline`. `SearchResults` virtualizes the 56px result rows inside a
271px dropdown. `SearchDateDialog` uses Ark's dialog and one shared date-picker state machine
inside a virtual month list: 40px headings/cells, 4px week gaps, and a 312px desktop / 280px mobile scroll viewport.
Six-week months retain their full height below the viewport; the header and confirmation never
scroll. Partially visible month headings retain their space but hide their text until the
whole heading row is visible, avoiding a clipped title above the footer. Month arrows animate
the scroll offset, and the title follows the viewport center,
matching `popups/datePicker.tsx`. Month geometry, day labels, and date values are prepared once
on open. Memoized month grids render native day buttons; Ark retains selection and table keyboard
navigation. Scroll state stays below the shared date-picker hook, and buffered virtual updates
avoid synchronous React flushes during scrolling. An IntersectionObserver updates each heading's
visibility without rerendering its date grid.
Public-post search requires Telegram connectivity and is not offered in the local study.

`ChatApp.module.css` follows `_rightSidebar.scss` and `_chat.scss`: the profile slides by its
full width and the chat moves with a transform. The profile remains mounted after its first
open so closing has an exit animation and reopening retains the selected tab and scroll.
Below the docking threshold it overlays the chat rather than squeezing the message column.
Reduced motion disables these transitions. The profile content remains a smaller local demo.

`ChatHeaderMenu` follows `topbar.ts` for group menu ordering and the mobile search entry.
`useHeaderActions` reuses the list's mute and removal dialogs and persistence. Message selection
keeps the composer mounted with its draft. Auto-delete captures a deadline on each new outgoing
or incoming message; old history is unchanged. Expiration runs while open and on restore/focus.
Video Chat explains the local-only limitation and never starts a network call.

## Pointer, keyboard, selection, and scroll boundaries

`useInputModality` enables focus rings only after navigation keys. Typing and caret movement
inside an editor keep pointer mode, and overlay focus restoration cannot add a pointer ring.
Ark controls and the voice seek control follow the same rule. `IconButton` keeps its accessible
name without adding a native browser tooltip to every icon.

The device policy follows `environment/touchSupport.ts` and `index.ts`. `main.tsx` records
touch support once, independently of keyboard focus. The zero-specificity device selectors
must not outrank a component's selected or open state.

The hover policy follows `mixins/_hover.scss`, `_button.scss`, and `_chatlist.scss`:

- Non-touch devices enable hover and pressed styles on individual interactive controls.
- Ordinary controls use the neutral hover color; primary and danger actions keep their own colors.
- Selected conversations keep their accent background. An open context menu keeps its row highlighted.
- Menu press scaling and ripple feedback also work on touch devices. Keyboard menu highlighting
  remains available without enabling synthetic touch hover.

The selection policy follows `base.scss` and `_chatBubble.scss`:

- Interface text is unselectable; inputs and editable content explicitly allow selection.
- Desktop bubble content is selectable outside message-selection mode, including link previews,
  document descriptions, code, quotes, and media captions.
- Sender labels, forwarded headers, metadata, buttons, media, voice controls, and contact cards
  opt out of selection even inside a selectable bubble.
- Desktop message-selection mode disables text selection. On touch devices, bubble text becomes
  selectable in message-selection mode, as in tweb.

Scroll containment follows `_scrollable.scss`; `none` is not a global application policy.
The fixed document uses `overflow: hidden`, while each actual scroll container owns its axis:

| Surface                                                          | Scroll policy                                           | Source reference                           |
| ---------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------ |
| Conversations, archived conversations, message history, previews | Vertical containment                                    | `scrollable.ts`, `_scrollable.scss`        |
| Conversation search, message search, sender results              | Vertical containment                                    | `sidebarLeft/index.ts`, `_chatSearch.scss` |
| Chat information, archive settings, scrollable dialogs           | Vertical containment                                    | `sliderTab.ts`, popup scrollable           |
| Calendar month viewport                                          | Vertical containment                                    | `popups/datePicker.tsx`                    |
| Multiline message editor                                         | Vertical containment                                    | `chat/inputEditor`, live editor scrollable |
| Long code blocks                                                 | Horizontal containment; vertical gestures reach history | Horizontal scrollable policy               |

`overscroll-behavior-y: contain` retains native edge feedback but prevents scrolling another pane.
Horizontal containment leaves the vertical axis alone. Non-scrolling headers, buttons, and layout
wrappers do not receive overscroll overrides. The current emoji grid fits its popover and does not
have an independent scroll viewport; tweb's larger emoji and sticker catalogs use scrollables.

## Tests worth reading

`reducer.test.ts` follows user-visible state changes rather than asserting private function calls.
`ConversationPane.test.tsx` drives real Ark menus with a keyboard and saves an edit.
`MessageComposer.test.tsx` controls the asynchronous image decoder boundary to reproduce completion
out of order. `composerKeyboard.test.ts` protects input-method composition. `storage.test.ts`
rejects malformed saved state and out-of-range timestamps before rendering.

## Extending the study

For real Telegram connectivity, replace local history availability with a transport boundary and
reconcile server IDs with stable local IDs. Keep loaded-data limits distinct from the virtual DOM
window. Rich text currently has plain, quote, and code variants; it does not implement Telegram's
complete entity schema. Native video controls, local poll voting, and emoji stickers intentionally
remain smaller than their upstream counterparts.

See [verification notes](./virtual-history-verification.md) for the recorded browser checks.
