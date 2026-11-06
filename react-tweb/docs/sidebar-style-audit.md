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
