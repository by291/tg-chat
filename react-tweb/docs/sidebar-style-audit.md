# Sidebar styling and interaction reference

The reference is the local tweb checkout at `/Users/by291/code/js/tweb` and the live Telegram K
sidebar inspected on November 6, 2026. Conversation content remains local demonstration data.

## Measurements and source map

| Detail            | Reference                                                                                 | React implementation                         |
| ----------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| Conversation row  | 72px height, 54px avatar, 16px corner radius                                              | `ChatRow.tsx`, `ChatSidebar.module.css`      |
| Title and preview | 16px type, 22px lines, 2px between lines                                                  | `ChatSidebar.module.css`                     |
| Timestamp         | 12px type with an independent 16px line box                                               | `ChatSidebar.module.css`                     |
| Unread badge      | 22px minimum width and height, 22px line height, 7px horizontal padding, 14px medium type | `ChatSidebar.module.css`                     |
| Search field      | 44px height, 200ms focus color and background transition                                  | `ChatSidebar.module.css`                     |
| Search content    | 150ms zoom/fade, entering from scale 1.1                                                  | `ChatSidebar.tsx`, `ChatSidebar.module.css`  |
| Menu/back icon    | 18px bars, 250ms rotation and bar transforms                                              | `SidebarMenu.tsx`, `ChatSidebar.module.css`  |
| Menu surface      | 200ms, scale 0.8 to 1, cubic-bezier(0.4, 0, 0.2, 1)                                       | `overlays.module.css`                        |
| Press ripple      | Pointer-origin expansion to the farthest corner; hold until release, then fade            | `components/Ripple.tsx`, `Ripple.module.css` |

Relevant tweb files:

- `src/scss/partials/_row.scss` and `_chatlist.scss` define row geometry and subtitle spacing.
- `src/scss/partials/_badge.scss` gives badges their own line height.
- `src/scss/partials/_inputSearch.scss` defines the focus and clear-control transitions.
- `src/components/sidebarLeft/index.ts` selects the 150ms `zoom-fade` search transition.
- `src/scss/partials/_transition.scss` and `_animatedIcon.scss` define search and icon transforms.
- `src/scss/partials/_button.scss` defines menu scale, origin, and item press feedback.
- `src/components/ripple.ts`, `src/scss/partials/_ripple.scss`, and `src/scss/base.scss` define ripple
  geometry, release timing, and the 700ms desktop / 400ms compact duration.
- `src/scss/fonts/_roboto.scss` references the Latin regular and medium fonts bundled locally here.

## React ownership

`ChatSidebar` owns the query, search mode, and focus restoration. The normal list stays mounted
while search is open, preserving its scroll position. The inactive panel is inert and hidden from
assistive technology. Clearing the field keeps search open; Escape or Back restores the full list;
choosing a result closes search and opens that conversation.

`SidebarMenu` delegates menu navigation, dismissal, and presence to Ark UI. CSS supplies both enter
and exit animations. The main menu expands from its top-left corner. Other menus retain Ark's
placement-dependent transform origin.

The main menu has a transparent dismissal layer, matching tweb's `OverlayClickHandler`.
When it is open, a pointer click on Search first dismisses the menu without focusing the input
or activating the control underneath. A second click opens Search. The layer consumes the full
press/click sequence; Ark still owns Escape, keyboard navigation, and focus restoration.

`Ripple` is a decorative child of its control. Native pointer and keyboard listeners observe presses
without replacing React or Ark handlers. Each active press owns abortable release listeners; fade
timers and listeners are disposed on unmount. Pointer cancellation, leaving the control, losing
focus, and window blur all release feedback. Icon buttons, conversation rows, local search results,
and sidebar menu items reuse it. Reduced motion displays a static highlight instead of expansion.

Sidebar controls inherit the theme's default ripple color: 8% black in light mode and 8% white
in dark mode. Selected conversation rows and the compose button do not override it. Telegram uses
local overrides for some other controls, including primary-tinted action plates and danger actions;
the selected purple background alone does not imply a white ripple.

`app/useInputModality.ts` records pointer versus keyboard input before overlay handlers run.
This avoids showing a keyboard outline when a pointer-operated menu restores focus, while keeping
the outline for Tab navigation and keyboard dismissal.

## Verification and scope

- Component tests cover search dismissal, focus restoration, clearing, selection, and menu actions.
- Ripple tests cover held presses, cancellation outside the control, keyboard repeat, focus loss,
  and cleanup while a control is pressed.
- Chrome checks covered desktop and 390px-wide layouts, light and dark appearance, pointer and
  keyboard focus, menu exit presence, and reduced-motion behavior.
- Browser font inspection confirmed that unread digits use the bundled Roboto Medium font.
- Single-digit badges measure 22 by 22px; two-digit badges expand horizontally without changing
  their height or line height. Avatars and message metadata also have independent line boxes.

Search operates on the local conversations. Telegram's remote search categories, account controls,
and server-driven recent-search history are outside this local demonstration. The menu retains the
working Saved Messages and theme actions instead of presenting controls with no local behavior.

## Conversation context menu

`src/components/dialogsContextMenu.ts` supplies the upstream item order and state-dependent labels.
The local `ConversationMenu` uses Ark's pointer-anchored context menu with 32px rows, medium 14px
type, 18px line height, 20px icons, and red destructive text. It shares the existing menu animation,
ripple, and outside-click dismissal layer. Right-clicking a row does not select or read it.

The local menu supports opening a new tab, previewing, selecting, toggling read status, pinning,
muting, archiving, clearing history, and deleting. Saved Messages omits mute and archive. Preview
does not mark messages as read; opening the conversation does. Clear and delete require a dialog.
Archived conversations remain reachable through the archive entry. Multi-selection exposes read,
pin, mute, archive, and delete actions. The former Local demo footer label is removed.

`useSidebarActions` owns temporary selection and dialogs. `conversationList` resolves fixture values
and persisted overrides. `state/conversationActions` updates preferences or clears local messages
and drafts. The optional preferences field preserves compatibility with existing saved snapshots.

Single-chat mute opens the Notifications dialog: one, four, or eight hours; one or three days;
or forever. The deadline is stored locally. `useConversationList` schedules the next expiration
and refreshes after window focus or document visibility changes. Unmute applies immediately;
bulk mute uses the permanent toggle, matching the upstream selection action.

Saved Messages grouping, server permissions, and folder-specific commands are not reproduced.
Opening a new tab selects the requested local chat; cross-tab editing reconciliation is unsupported.

## Sidebar page navigation

Telegram's `SidebarSlider` in `src/components/slider.ts` selects the `navigation` transition.
`slideNavigation` in `src/components/transition.ts` moves the incoming page from the full sidebar
width while shifting the previous page left by 25% and reducing its brightness to 80%.
`src/scss/partials/_slider.scss` applies the standard transition tokens: 300ms entering, 250ms
returning, both with `cubic-bezier(0.4, 0, 0.2, 1)`. These CSS timings were also read from Web K.

`SidebarNavigation` owns this shared two-page transition, including the header and content.
Both pages stay mounted with independent virtual viewports, so returning preserves scroll position.
Inactive pages become inert immediately and hidden when their exit transition ends. CSS transitions
can reverse from their current position without a timeout or a forced remount. Reduced motion
switches pages immediately. Entering focuses the secondary page's first button; returning restores
the primary page's last available button without scrolling or reopening search through input focus.

The main menu and archive row open the same archive page. Back and Escape return to the inbox;
Escape first dismisses selection when selection is active. `SidebarPageHeader` retains the normal
header underneath each page's selection toolbar. Search keeps its separate 150ms zoom-fade behavior.

## Preview and selection

`src/components/popups/chatPreview.tsx` and `src/scss/partials/popups/_chatPreview.scss` define the
upstream preview. `ConversationPreview` follows its 432 by 540px desktop size, 8px sidebar gap,
viewport clamping, and 120ms opacity transition. On narrow screens it becomes a centered modal
with 8px side gutters. Resizing closes it because the row anchor belongs to the previous layout.

The preview reuses `MessageTimeline` and its normal bubble renderers, grouping, and virtual history.
It starts at the latest message and remains scrollable. Bubble interactions are inert, as upstream;
preview message IDs use a separate prefix so the main conversation keeps unique DOM IDs. The
floating 48px header contains close, avatar, name, and subtitle. The 48px bottom plate toggles
read/unread without selecting the conversation or closing the preview. Shift-click opens the same
preview from a row. The main conversation and composer stay mounted throughout.

`dialogsSelectionHeader.tsx`, `dialogsSelectionBase.ts`, and `_chatlist.scss` are the selection
references. The normal header stays mounted under a 200ms fading selection plate. The plate shows
the selected-chat count and a More menu. Each row opens a 38px lane for its 24px checkbox; avatar
and text translate over 300ms. Selecting alone adds no row background. Pinned rows replace their
metadata with a drag grip, and dragging changes persisted pinned order.

Ordinary row reordering follows `createItemGlide` in `verticalVirtualList.tsx`: commit the new
layout top, then animate the outer transform from the previously drawn position over 120ms with
`ease`. This differs from the 300ms sortable-drag transition. `useConversationGlide` reads the
current transform before replacing an interrupted animation, so repeated moves remain continuous.
Moving rows get an opaque surface background; the active row keeps its accent background.
Newly mounted rows do not glide from an unrelated position. The checkbox lane has its own transform.

Mute icons enter
and leave over 200ms. Unread and pinned badges scale over 250ms with the upstream overshoot curve;
muted badge colors transition too. Presence is retained through exits instead of clearing content
as soon as an action closes its dialog. Initial mounts and returning virtual rows do not replay
state-change animations. Reduced motion removes movement.

Manual browser checks covered anchored and narrow-screen previews, selection and Escape behavior,
mute confirmation and unmute, pinned dragging, and list windowing. No new tests were added or run.

## Upstream conversation-list virtualization

Telegram K virtualizes the left conversation list as well as the message history. Follow this chain:

1. `src/components/autonomousDialogList/dialogs.ts` constructs `SortedDialogList`.
2. `src/components/sortedDialogList.ts` creates `createDeferredSortedVirtualList`.
3. `src/components/deferredSortedVirtualList.tsx` renders `VerticalVirtualList` with
   `thresholdPadding={72 * 4}`, approximately four normal rows beyond each viewport edge.
4. `src/components/verticalVirtualList.tsx` computes visibility from scroll position and row layout,
   mounts visible entries conditionally, and positions them within the full list height.

The deferred layer also coordinates pinned ordering, loading, and retained data. Its extra cached
items are distinct from mounted DOM rows. `VirtualConversationList` uses the existing TanStack
Virtual dependency for the normal and archived lists: 72px rows, stable conversation IDs, and four
overscan rows at each edge. The archive entry is a keyed virtual row, not padding outside the list.
Separate scroll offsets survive
switching between the main list and archive; search leaves the main list mounted.

Archiving removes the conversation immediately and lets remaining mounted rows glide into place.
Newly inserted conversations and the archive entry appear at their destination without a separate
fade. Removing the last archived conversation removes the entry with the same list update.
`conversationScrollAnchor` follows upstream `useShouldAnimate`: compare rows visible in either
layout, and adjust the scroll offset when all of them move by the same amount. Those updates skip
the glide so changes above the viewport do not make every visible row slide together.

Arrow keys, Home, and End scroll the virtualizer before focusing the destination row. In a 1100 by
300px browser viewport, seven of the nine fixture conversations were mounted. End moved the
window to the last conversation and focused it; the first two DOM rows were then unmounted.
The outer panel uses `overflow: clip` so search's scale transition cannot turn it into a second
programmatically scrolled viewport. Search results retain their separate compact rendering.

## Archive menus and settings

`archiveDialogContextMenu.ts` supplies the upstream archive entry's context menu and the archive
page's More menu. `ArchiveMenu` shares the same commands between both entry points: Search,
Hide/Show in Chat List, Mark All as Read, Archive Settings, and How does it work. The read command
appears only when archived conversations have unread state. Its operation affects those
conversations only; the archive badge counts unread conversations rather than all archived chats.

Search returns to the primary page with an Archive scope chip and focuses the input after menu
focus restoration. Removing the chip restores the full search scope. Hiding the archive row
preserves access through the main menu; its visibility preference persists in the existing
IndexedDB snapshot.

`archiveSettingsTab.tsx` is the settings reference. The local settings page uses the shared sidebar
transition, an explicit Save action, and a Save/Discard/Cancel prompt when leaving changed values.
The unmuted-chat preference is persisted. The reducer's `receive` action applies it to local
incoming messages: muted chats stay archived, while unmuted chats leave unless retention is on.
There is no connected transport or automatic incoming-message generator in this demo.

Folder-specific retention is disabled because this project has no chat folders. Automatic
archiving of unknown senders and Stories remain unavailable. The help dialog describes these
limits and links to settings. It uses a static archive icon instead of Telegram's animated sticker.

Manual browser inspection covered both menu entry points, scoped search, hide/show, saved settings,
the unsaved-change prompt, help, and conditional bulk-read behavior. No tests were added or run.
