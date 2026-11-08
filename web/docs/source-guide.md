# Reading the React Conversation Implementation

## Start with the ownership chain

Read these files in order:

1. `index.html` paints the initial background and sidebar before application modules arrive.
2. `src/main.tsx` mounts React and global styles; `src/App.tsx` installs navigation and input policy.
3. `src/pages/chat/ChatPage.tsx` coordinates URL selection, chat state, and feature panels.
4. `src/layouts/chat/ChatLayout.tsx` arranges the sidebar, conversation, details, and overlay slots.
5. `src/features/chat/state/useChatState.ts` restores IndexedDB and persists reducer snapshots.
6. `src/domain/messages/message.ts` and `src/domain/conversations/conversation.ts` define contracts.
7. `src/features/chat/state/chatState.ts` validates snapshots; `chatActions.ts` defines reducer actions.
8. `src/features/chat/state/reducer.ts` owns permanent state transitions.
9. `src/features/chat/ConversationPane.tsx` translates user commands into those actions.
10. `src/features/chat/history/MessageTimeline.tsx` owns scrolling and sender grouping.
11. `src/features/chat/messages/MessageBubble.tsx` renders messages and their action menus.
12. `src/features/chat/composer/MessageComposer.tsx` owns draft editing and sending.

## First paint and conversation restoration

`index.html` includes critical frame styles and noninteractive sidebar markup. A small inline script
reads the existing appearance preference to choose light/dark surfaces and a saved solid background;
it never writes storage. Other wallpapers use a gradient fallback until React resolves the complete
palette and retrieves any custom image. Keep the static sidebar dimensions aligned with
`src/layouts/chat/ChatLayout.module.css` and its placeholder markup aligned with `src/layouts/chat/StartupSidebar.tsx`.

`ChatPage` mounts the real wallpaper and layout before IndexedDB restoration completes. Its sidebar
placeholder uses the same inline styles as the HTML frame. Only data-dependent conversation controls
wait for `isReady`; the wallpaper stays mounted across that transition. A storage failure still
finishes restoration and shows the existing usable demo state with an error notice.

The original HTML frame remains outside the React root until content is ready.
`useStartupTransition` fades this retained cover out over 150ms, then removes it. The visible
conversation rows fade in over 150ms each, staggered by 15ms. Only the initial visible rows
participate;
hidden sidebar pages and offscreen virtual rows are excluded, and later list updates do not replay
the entrance. Reduced motion skips both transitions. The cover is inert and pointer-transparent,
so ready controls work during the fade. Keeping the painted frame through the handoff avoids
replacing it abruptly.

This separates visible layout from data readiness without adding component lazy loading. Telegram
Web K follows a related order: `src/index.ts` attaches its background, `pages/bootstrapIm.ts`
exposes
the existing HTML frame before loading the app's top level, and `autonomousDialogList/base.ts`
manages
list placeholders independently. Its `helpers/dialogsPlaceholder.ts` fades placeholders out, with
staggered rows at the full animation level and a whole-layer fade at the reduced level. Web K also
dynamically imports optional features such as poll creation and the media editor, and
`wrappers/photo.ts` schedules uncached images through a lazy queue.

## Directory layout

The top level separates application assembly, workspace orchestration, visual layout, domain
contracts, business features, and shared infrastructure. Feature internals group behaviors rather
than collecting every component or hook in one large directory. Styles and tests stay with owners.

| Directory                         | Responsibility                                                               |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `src/App.tsx`                     | Router setup and application-wide input policy                               |
| `src/pages/chat/`                 | Workspace state and cross-feature orchestration                              |
| `src/layouts/`                    | Responsive chat geometry, startup handoff, and sidebar transitions           |
| `src/domain/messages/`            | Message/media schemas, interactions, emoji entities, safe rich text          |
| `src/domain/conversations/`       | Conversation identity and preference contracts                               |
| `src/features/chat/conversation/` | Sending, editing, forwarding, deletion, and navigation ownership             |
| `src/features/chat/composer/`     | Composition shell, attachments, forms, picker, and reply/edit context        |
| `src/features/chat/messages/`     | Bubble assembly, content, reactions, menu, selection, and forwarding         |
| `src/features/chat/history/`      | Timeline, virtual measurements, scroll anchoring, and sender groups          |
| `src/features/chat/rich-text/`    | Rendering semantic message HTML, quotes, code, and formulas                  |
| `src/features/chat/state/`        | Snapshot schema, action contracts, reducer, persistence, and restoration     |
| `src/features/chat/details/`      | Conversation and sender information                                          |
| `src/features/editor/`            | Lexical editing, custom nodes, serialization, toolbar, and editor plugins    |
| `src/features/conversations/`     | Sidebar coordinator, list/search views, archive, and creation                |
| `src/features/settings/`          | Settings panels, profile, preferences, appearance, notifications, devices    |
| `src/features/media/`             | Viewer, playback, geometry measurement, gesture math, and input coordination |
| `src/features/emoji/`             | Custom emoji catalog and inline artwork                                      |
| `src/features/stickers/`          | Sticker catalog and animation playback                                       |
| `src/components/`                 | Generic UI, including shared overlay/menu/dialog presentation                |
| `src/hooks/`                      | Generic input modality and retained closing-dialog values                    |
| `src/lib/`                        | Preference stores, keyboard conventions, code labels, and formula rendering  |
| `src/routes/`                     | URL navigation and conversation selection synchronization                    |
| `src/styles/`                     | Global tokens and reset                                                      |

There is one top-level chat workspace. Settings, archive, and conversation creation remain embedded
sidebar features. Query parameters, history behavior, panel mounting, and loading boundaries are
unchanged. `ChatPage` connects features; `ChatLayout` arranges rendered slots without importing
business state.

Inside `messages`, `content` groups media, contact, poll, and checklist renderers. `reactions` owns
reaction selection, flight, and layout animation; `forwarding`, `selection`, `menu`, and `transitions`
own their respective interactions. The bubble and metadata remain at the messages entry level.
Inside `composer`, `attachments`, `forms`, `picker`, and `context` keep UI and behavior together.
The editor owns Lexical nodes and editing mechanics; sending and attachment preparation remain
composer/conversation responsibilities.

`ConversationPane` composes the screen and retains overlay/animation lifetimes. Its conversation
hooks separately own composer submission, dialog transitions, message commands, and navigation.
`ChatSidebar` coordinates sidebar destinations; list/archive views render their pages, while
`useSidebarSearch` owns search scope and focus handoff. `ComposerFormattingToolbar` renders controls;
its selection, dialogs, keyboard shortcuts, and command definitions have separate owners.
`MessageComposer` owns submission and edit context; `attachments/useComposerAttachments` owns file
selection, decoding, preview state, and cancellation across file input, drop, and paste.
`EmojiEditor` retains one shared selection reference while `useEditorValueSynchronization`,
`useEditorInputCommands`, and `useEditorControls` own value synchronization, keyboard/paste commands,
and imperative palette operations respectively.

`useViewerTransform` owns transform state, geometry, and settling. `useViewerPointerInput` adapts
drag/pinch/pointer continuation and `useViewerWheelInput` adapts wheel/modifier input to that owner.
`viewerGeometry` measures layout and `viewerGesture` calculates pan, inertia, and swipe decisions.
`lib/mediaPlayback` arbitrates audible playback across messages and the viewer; message visibility
observation stays with message rendering. `historyViewportPolicy` defines read and prefetch decisions;
`useVirtualHistory` retains scroll scheduling, request deduplication, navigation, and anchor recovery.

Use `@/` for cross-owner imports and relative paths within an owner. Import the owning module
directly; old paths do not retain compatibility barrels. The domain modules do not import features,
React components, application state, or persistence. Message sanitization remains the same DOMPurify
policy and still runs before storage/restoration and rendering.

`ChatState` and `ChatAction` remain under chat state because they describe application coordination,
not reusable message values. Shared components, hooks, and infrastructure must not import features.
Generic overlay styles live under `components/overlays`; mute-specific controls keep their styles
beside `ConversationMuteDialog`. Small shared tools live directly under `lib`; `codeLanguages.ts`
keeps language aliases, labels, grammar dependencies, and syntax hints together.

The source guide is the current ownership map. Dated implementation plans retain the paths used
when they were written. No storage migration, new feature loading boundary, or public asset change
is part of this refactor.

## Follow one send

The composer receives a draft and reports edits through `onDraftChange`. The conversation pane
dispatches `set-draft` with a chat ID. On Enter, `shouldSubmitMessage` checks Shift and IME state
before the composer reports a `ComposedMessage`.

The pane's `useConversationComposer` hook creates the message ID and timestamp, attaches the current
reply reference, and dispatches `send`. The reducer appends the message and clears that chat's draft.
Sending a sticker preserves the separate text draft. React renders the new message; the timeline
follows a new outgoing message to the bottom; the persistence hook writes the updated snapshot.

## Keep permanent and temporary state separate

Messages, drafts, conversation preferences, and the applied chat selection live in the reducer.
React Router owns the requested chat selection. Appearance, application preferences, and notification
preferences use Zustand stores with selective subscriptions.
Open menus, active search,
the editing target, reply target, delete confirmation, and photo viewer are temporary UI state.
The conversation pane is keyed by conversation ID, so a reply or edit cannot leak into another chat.
The composer is keyed by the editing message ID, so changing the edit target resets its editing text.

`ConversationDirectoryProvider` derives the catalog and effective preferences for the workspace,
including one shared mute-expiration timer. Its metadata inputs exclude drafts and message contents.
`ChatPage` indexes messages by conversation when the message collection changes; sidebar previews,
profile media, conversation details, and the viewer reuse that index. Rows receive their own draft,
preview, and selection state instead of the complete snapshot. Contact and sender action contexts
keep stable values across unrelated draft edits.

Message arrival detection follows message-collection changes and readiness; notification delivery
reads the current policy without replaying messages suppressed by an earlier preference. Selected
deletion and forwarding use batch reducer actions, preserving recipient drafts and message order
while validating duplicate IDs and assigning destination expiration rules once per accepted message.

Only validated saved data reaches rendering. Timestamps must be inside JavaScript's valid Date
range. A failed read leaves the default conversations usable; a failed write produces a visible
storage notice. One tab is the supported editing owner; cross-tab reconciliation is not implemented.

### URL navigation and preference ownership

`src/App.tsx` mounts `BrowserRouter`. `src/routes/useAppNavigation.ts` owns the `chat`, `sidebar`,
`settings`, and `settingsPage` search parameters. Existing `?chat=` links continue to work, and
unrelated parameters survive navigation. Settings categories and search results use stable catalog
IDs; General Settings also supports the nested `power` and `wallpaper` destinations. Invalid settings
destinations show the overview. Browser back and forward restore the URL destination; panel back
buttons reuse a known parent history entry or replace a direct link with its parent.

`useChatRoute.ts` waits for chat hydration before applying a requested conversation. Unknown or
deleted chats show the unselected screen and cannot be resurrected by browser history. Explicit chat
selection may reopen a deleted local contact. Sidebar panels retain their mounted contents, focus,
and scroll positions; menus, confirmation dialogs, creation forms, and search text remain local UI state.

`src/lib/createPreferenceStore.ts` uses Zustand for snapshots and subscriptions while retaining
the existing localStorage keys, raw JSON shapes, Zod validation, and cross-tab storage events. Hot
rendering paths select individual preferences, such as time format or large emoji, so unrelated
settings do not invalidate their subscriptions. Imperative readers remain available to playback
and notification owners. Preference write failures still allow changes within the current session.
Chat IndexedDB persistence and the conversation reducer's business rules remain in place.

### Ordinary animation values

`src/features/chat/messages/content/poll/usePollResultAnimation.ts` retains the choice/path/result phases and uses Motion values
for percentage and bar interpolation. `PollOption` renders these values directly, avoiding React
state updates on every frame. Interrupted votes continue from their visible values; restored results
and reduced-motion requests display their final values immediately. Message flights, reaction
geometry, virtual history measurements, scroll anchors, CSS transitions, and native theme view
transitions retain their existing owners.

For sidebar actions, read `src/features/conversations/ConversationMenu.tsx`, `src/features/conversations/useSidebarActions.ts`, and
`src/features/chat/state/conversationActions.ts`. The menu names available commands, the hook owns selection and
confirmation dialogs, and reducer helpers persist the actual changes. `src/features/conversations/conversationList.ts`
combines fixture defaults with saved preferences, resolves mute deadlines, and orders pinned chats.
`src/features/conversations/VirtualConversationList.tsx` owns the fixed-height sidebar window and pinned drag order.
`src/layouts/sidebar/SidebarNavigation.tsx` moves whole sidebar pages with Telegram's forward/back transitions;
the inbox and archive retain independent scroll positions. `SidebarPageHeader` shares the selection
overlay behavior between their headers.
`src/features/conversations/ConversationPreview.tsx` positions a read-only instance of the existing message timeline;
it does not maintain a second set of bubble renderers. See the
[sidebar audit](./sidebar-style-audit.md) for upstream menu and list-virtualization references.

## Virtual history and scrolling ownership

Read `historyRows.ts`, `useHistoryWindow.ts`, `useVirtualHistory.ts`, and `historyAnchor.ts` after
`MessageTimeline.tsx`. Each has a separate responsibility:

- `historyRows.ts` derives dates and sender groups from the complete message sequence.
- `useHistoryWindow.ts` starts with 60 rows and exposes 80 earlier rows near the loaded boundary.
- `useVirtualHistory.ts` connects TanStack Virtual with eight overscan rows, stable keys,
  `anchorTo: 'end'`, and `followOnAppend`. Wheel, touch, and keyboard gestures cancel active jumps.
- `historyAnchor.ts` preserves the visible key and row-relative offset when the message column width
  invalidates cached text wrapping. It uses the virtualizer's scroll API for restoration.

Data availability and mounted DOM are different windows. A distant reply may expose all 1,000
local archive messages, while only the visible rows and overscan are mounted. The current local
repository keeps all messages in memory. A future transport can replace this availability layer
without taking ownership of DOM measurements.

New incoming content follows only when within 80px of the bottom. An explicit send returns to the
latest message. Deleting the last message is not treated as an append. ID navigation expands the
available window before resolving a measured scroll offset; it never assumes the target DOM exists.
Search filters rendered rows but retains a lookup of the complete conversation for reply previews.

Width changes are different from prepends. `measure()` invalidates cached heights but does not
itself preserve a reading key. The latest stable reading anchor is captured before width changes,
because child ResizeObserver notifications can precede the content-width notification. Surface-only
width changes keep the height cache. After invalidation, mounted rows explicitly seed their actual
heights with `resizeItem`: `measureElement` may skip reads during scrolling, and unchanged elements
will not produce another resize event. The same key and offset are then restored. Composer-height changes
retain bottom following only if the reader was already at the end.

The scroll surface and message column have different widths. The surface fills the entire middle
zone, from the conversation sidebar's edge to the page edge or docked profile. Only `.messages`,
the header, and the composer use the centered 696px content width. This follows `.bubbles` and
`.bubbles-scrollable` in tweb's `_chat.scss`: wallpaper margins accept native wheel/touch scrolling,
and history continues behind the floating controls with an eased edge mask.

`useChatOverlayInsets.ts` measures the header, pinned plate, composer, and selection toolbar.
Their occupied heights become virtualizer padding rather than reducing the scroll viewport.
Row estimates use the content element's width, not the wider scroll surface. ID navigation centers
short messages in the unobscured area and places tall messages below the header. Reply/edit bars
can grow without moving the viewport boundary or leaving the final message behind the composer.
Chat previews omit these overlay insets and retain their own contained layout.

Virtual rows are positioned separately from their bubble animations. Initial messages and rows
returning from offscreen do not replay entry animations. Audio and video pause when their message
leaves the viewport; unmounting also disposes playback.

The local reference uses the same library in
`/Users/by291/devel/js/virtual-demo/src/hooks/useVirtualChat.ts` and
`src/lib/mediaBox.ts`. Its fixed-frame initial settling is replaced here with a cancellable
post-commit scroll that also survives React Strict Mode's effect remount.

Official references: [chat guide](https://tanstack.com/virtual/latest/docs/chat) and
[virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer).

### Date header ownership

`historyDates.ts` derives measured day bounds from the virtualizer and keeps every day represented
in the rendered row range. A day uses its calendar date as its key, including a paged window that
begins halfway through that day. Loading earlier messages must not remount the visible header.

`StickyDateHeaders.tsx` renders one header inside each measured day container. Native CSS sticky
positioning performs the handoff: the old header is constrained by its day container while the next
header approaches. Both remain mounted during that overlap. There is no separate floating copy,
manual position animation, or timer that replaces one label with another.

The private visibility hook stores only the active day and whether scrolling is active. Scroll
coordinates are read to resolve that day, not saved as per-frame React position state. The idle
timeout changes visibility; CSS owns the 300 ms opacity transition and its reversal. Changing the
virtual window updates geometry without restarting the idle timeout.

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

Message-ID navigation uses `src/features/chat/history/animateHistoryNavigation.ts`, following tweb's
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
`src/features/chat/messages/content/media/deferredMedia.tsx` postpones new photo, album, link-image, reply-thumbnail, and video-poster
sources during navigation. Existing images remain visible, frames retain their dimensions, and
media loading resumes after the temporary range is released. Audio and video already use
`preload="none"`. This coordination is local to the history view, not a global application lock.

`src/features/chat/messages/menu/MessageMenu.tsx` owns one Ark menu per history view. `useMessageMenu.ts` delegates pointer,
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

The archive entry and archive page header share `src/features/conversations/archive/ArchiveMenu.tsx`. Their commands live in
`src/features/conversations/archive/useArchiveActions.ts`; `ArchiveSettingsPage.tsx` owns the editable settings view and
`ArchiveDialogs.tsx` owns help and confirmation dialogs. `SidebarNavigation.tsx` keeps both pages
mounted while sliding between them, including the nested settings page. Archive preferences are
optional fields in the saved state, so existing snapshots continue to load. The reducer's `receive`
action in `src/features/chat/state/incomingMessages.ts` applies the saved retention preference to local incoming
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

| Original tweb source                    | Responsibility                       | React counterpart                           |
| --------------------------------------- | ------------------------------------ | ------------------------------------------- |
| `src/components/chat/chat.ts`           | Conversation coordination            | `ConversationPane.tsx`                      |
| `src/components/chat/bubbles.ts`        | Message DOM and history ownership    | `MessageTimeline.tsx`                       |
| `src/components/chat/input.ts`          | Composer and send flow               | `MessageComposer.tsx`                       |
| `src/scss/partials/_chatVariables.scss` | Bubble geometry and composer timing  | CSS Modules and `global.css`                |
| `src/scss/partials/_chatTopbar.scss`    | Floating toolbar and pinned plates   | `ChatHeader.module.css`                     |
| `src/scss/partials/_chat.scss`          | Centering, history, and input layout | `ChatLayout.module.css` and timeline styles |
| `src/scss/partials/_chatBubble.scss`    | Bubble states and media presentation | `MessageBubble.module.css`                  |
| `public/assets/img/pattern.svg`         | Wallpaper artwork                    | `public/assets/telegram-pattern.svg`        |

Observed geometry includes a 360px floating sidebar, a centered 696px conversation, a 48px toolbar
and composer, and 16px outer spacing. Upstream bubble values include 15px and 5px radii, 2px spacing
within a sender group, and 4px/5px/8px text padding. The frontend uses 200ms message/composer motion
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
Public-post search requires Telegram connectivity and is not offered in the current frontend.

`ChatLayout.module.css` follows `_rightSidebar.scss` and `_chat.scss`: the profile slides by its
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

`historyViewportPolicy.test.ts` covers foreground/read boundaries and older-history prefetch gates.
`useVirtualHistory.test.tsx` advances a fake animation clock through movement, interruption, and
completion; hover-delay tests also advance controlled time. TypeScript checks unused locals and
parameters alongside the existing strict checks.
`EmojiEditor.test.tsx` checks that external draft replacement preserves the mounted editor and does
not publish the previous draft again. Attachment tests also cover cancellation during replacement,
editing-mode draft retention, unmounts, sending, and input-mode changes.

`e2e/interactions.spec.ts` runs against a fresh production build in Chromium. It verifies archive
search focus, formatting-dialog selection restoration, forwarding cancellation back to the viewer,
and reading-anchor preservation after a viewport resize. It waits for stable row geometry before
comparing offsets, including deferred resize correction. Run `pnpm test:browser` after installing
Chromium with `pnpm exec playwright install chromium`. The dedicated server uses port 5193 and is
never reused; each test receives a clean browser context. Failure traces and screenshots are saved
under `test-results/`. Vitest discovery remains limited to colocated `src/**/*.test.{ts,tsx}` files.

`e2e/search.spec.ts` checks message-search keyboard confirmation, IME composition, focus restoration,
and keyboard navigation into virtual calendar months. Search result highlights keep the input
focused until confirmation; date navigation mounts and reveals its target before restoring cell
focus. The sidebar search shell retains closing content through its exit and releases the result
rows afterward, with large open result sets virtualized.

## Backend integration

For real Telegram connectivity, replace local history availability with a transport boundary and
reconcile server IDs with stable local IDs. Keep loaded-data limits distinct from the virtual DOM
window. Rich text currently has plain, quote, and code variants; it does not implement Telegram's
complete entity schema. Native video controls, local poll voting, and emoji stickers intentionally
remain smaller than their upstream counterparts.

See [verification notes](./virtual-history-verification.md) for the recorded browser checks.

## Message context menu

`src/features/chat/messages/menu/MessageMenu.tsx` owns the shared Ark UI menu. Its transparent positioning box contains
an independent 40px reaction capsule, an 8px gap, and a 196px action panel. Positioning includes
both surfaces when avoiding viewport edges. These dimensions and the separate entrance animations
follow tweb's `src/scss/partials/_button.scss` (`btn-menu-reactions-container`) and
`src/components/chat/contextMenu.ts`. Reactions use local Unicode emoji rather than Telegram's
animated reaction assets; the expanded palette is deliberately limited to the local demo.

Text and caption messages offer Copy; editable outgoing messages also offer Edit. Select enters
message selection mode with the target checked. Forward opens Share with, matching the card layout
and hidden recipient multi-select in tweb's `popups/forward.tsx` and `popups/_forward.scss`.
Choosing a normal destination prepares forwarded messages in its composer. Saved Messages sends
immediately; multi-recipient selection uses an explicit Send button and optional caption. Forwarded copies receive new IDs and omit source reactions,
pins, reply references and expiry; the destination's auto-delete policy applies without consuming
its saved draft. Server read receipts and permission-dependent Telegram actions are not fabricated.

### Message selection

`useMessageSelectionGesture.ts` follows `chat/selection.ts`: ordinary bubble text remains natively
selectable, while dragging across row margins starts message selection. Once selecting, crossed
rows are added or removed according to the first row's state. Fast movement fills skipped intervals.
The last unchecked message exits selection; Escape and the central count button also exit.
Incoming bubbles translate by 40px, avatars shrink to 76%, and the footer swaps between the mounted
composer and a delete/count/forward plate. Keeping the composer mounted preserves its attachment
and editing state. The virtual rows span the scrollport and own the message ID used by right-click, drag, click and
reply delegates. Their centered content remains 696px wide. A scrollport inline-size container lets
row bounds follow the panel without changing the content-width observer or overflowing horizontally.

Menus retain the mode captured when opened, so selecting a message does not replace the contents
halfway through the closing animation. In selection mode, an unselected message only offers Select.
A selected message offers bulk Copy, Forward, media Download when available, Clear selection, and
local Delete. Copy keeps the selection. Clear selection clears the whole group, not just the target.
Telegram's Report and moderation permissions require server-side capabilities and are not invented
for the local fixture conversations.

Forward drafts live above the keyed conversation pane, independently of the persisted text draft.
Changing chats preserves the pending forward. Reply, Edit, Cancel forwarding, and successful sending
clear the relevant forward context. Reload persistence for pending forwards is intentionally absent.

### Full-row message interactions

The row is an interaction surface, including the whitespace on both sides of its bubble:

- Desktop right-click opens the same menu anywhere on that row. There is no extra three-dot
  button beside ordinary messages. Keyboard users focus the row and use Shift+F10 or Context Menu;
  closing the menu restores row focus unless an action moves focus into the composer.
- A click while selecting toggles that row, including its whitespace and media.
- A drag from an unselected row adds crossed rows; a drag from a selected row removes them.
  The direction is fixed for that gesture, and visited rows are processed only once.
- Double-clicking row whitespace replies. Native word selection and interactive media, links,
  reactions and timestamps keep their own behavior.
- Touch taps open a message menu outside interactive children; a long press enters selection.
  The release after a hold is swallowed so the newly selected message stays selected.

These boundaries follow `chat/bubbles.ts`, `chat/selection.ts` and `chat/contextMenu.ts`.
Selected and menu-active rows share `--message-highlighting-color` and a 200ms linear fade,
following `_chatBubble.scss`. This color is supplied by the chat theme, not a universal black tint:
the reference wallpaper currently resolves it to `rgba(77, 88, 200, 0.4)`. The local wallpaper uses
that token; a future custom theme should supply its own value as tweb's `themeController.ts` does.

## Sorting, viewer gestures, and structured forms

`src/features/conversations/PinnedConversationSorting.tsx` gives dnd-kit explicit drag handles and drop targets.
Its cloned feedback leaves virtual row children in place; committed order is resolved from IDs
against all pinned conversations, including those outside the visible window. Selecting a chat
keeps the same mounted viewport and does not load another component.

`src/components/SortableList.tsx` owns poll sorting cancellation and keyboard focus restoration.
`src/features/chat/composer/forms/FormListRow.tsx` exposes each row's drag handle while retaining entry/exit animation.
`src/features/chat/composer/forms/useListForm.ts` owns React Hook Form state and field-array operations;
`src/features/chat/composer/forms/listFormSchema.ts` validates poll/checklist limits and dependent correct answers.

`src/features/media/useViewerTransform.ts` uses use-gesture for drag/pinch recognition while preserving viewer
geometry, wheel behavior, swipe thresholds, and momentum. Post-pinch continuation transfers to
the remaining pointer and ends when another pinch begins. Window blur cancels active input.
