# Telegram Conversation, in React

A local learning project that recreates the floating conversation interface observed in
Telegram Web K. The implementation uses React components and explicit state transitions rather
than embedding the upstream Telegram renderer.

## Run

Use Node.js 22.12 or newer and pnpm 11.

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite. The default is `http://127.0.0.1:5173/`.

```sh
pnpm test
pnpm build
pnpm format:check
```

## What works

- Floating conversation list, centered toolbar and composer, pastel patterned wallpaper.
- Responsive desktop and mobile navigation, plus a dark appearance.
- Conversation filtering and message search within the current conversation.
- Text messages, Shift+Enter newlines, and IME-safe Enter submission.
- Independent conversation drafts, restored after switching or refreshing.
- Reply previews, double-click to reply, and navigation to the original message.
- Editing, deleting with confirmation, pinning, copying text, and toggling reactions.
- Keyboard-accessible menus, a categorized emoji picker, and local animated sticker packs.
- Photo upload, paste, and drop into the composer; attachment preview and captions.
- Full-screen photo gallery with keyboard navigation and download.
- IndexedDB persistence for messages, text drafts, theme, and attached image data.
- Grouped bubble corners, entry animations, panel transitions, and reduced-motion support.
- Measured virtual history with local older-message paging, stable reading anchors, and ID-based jumps.
- A Message lab conversation with 1,000 archived messages and a media showcase.
- Albums, regular and circular videos, voice playback, files, link previews, contacts, and local polls.
- Forward labels, service messages, code blocks, quotes, and media-overlay timestamps.

Right-click a message or use its more button to open its actions. On touch screens, the more
button remains visible. Images are limited to 8 MB each and are never uploaded to a server.

## Deliberate boundaries

This is a local conversation study, not an authenticated Telegram client. The contacts and messages
are invented demonstration content. The original account's private conversation data is not bundled.

Delivery marks indicate local messages, not real network delivery or read receipts. Calls, recording
voice messages, remote GIF search, network presence, rich-text entities, and Telegram account settings
are not implemented. Sticker packs use locally bundled original TGS animations and generated
WebP previews.
The group information and mute control demonstrate local UI state; there is no notification service.

The history uses TanStack Virtual to bound mounted rows. Older pages currently come from the local
in-memory conversation; this is not remote history pagination. Persistence still writes complete
snapshots, so the bounded DOM does not imply bounded application storage. Text drafts persist; unsent image previews remain transient and are cleared when
switching conversations. Browser storage errors are reported in the interface.

## Dependencies and ownership

The source is organized into `src/app` for the shell, `src/components` for reusable UI, and
`src/chat` for the conversation. Chat subdirectories separate the composer, history, messages,
media, sidebar, details, state, and demo content. Components, CSS Modules, and related tests stay
together. See the [directory layout](./docs/source-guide.md#directory-layout) for the reading map.

| Library                    | Responsibility                                           |
| -------------------------- | -------------------------------------------------------- |
| React                      | Component rendering, reducer state, lifecycle            |
| Ark UI                     | Menu, popover, dialog, tabs, keyboard and focus behavior |
| CSS Modules                | Component-scoped visual styles                           |
| TanStack Virtual           | Dynamic row measurements, end anchoring, and bounded DOM |
| Motion                     | Message entry animation and reduced-motion preference    |
| Lucide                     | Consistent interface icons                               |
| idb-keyval                 | IndexedDB access                                         |
| Zod                        | Validation before restoring saved state                  |
| Vitest and Testing Library | State, keyboard, menu, and attachment regression tests   |

The lockfile pins the installed dependency graph. See [the source guide](./docs/source-guide.md)
for a reading order and a map back to the original tweb sources.

## Attribution

The wallpaper comes from Telegram Web K by Eduard Kuzmenko, licensed under GPL-3.0.
This study is distributed under GPL-3.0; see [LICENSE](./LICENSE) and
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). The sample illustrations and audio tone are original to this study. The sample video comes from
MDN's CC0 media collection. Voice playback uses a generated tone, not recorded speech. Video controls
use the browser player; Telegram's custom player, media-tail mask, and animated sticker engine are
not reproduced.

### Emoji and sticker picker

`src/chat/composer/emoticons/` owns the picker browsing behavior. Ark UI manages the popover,
tabs, tone popovers, sticker menus, and pack dialog. The 382 × 420 desktop panel, 49-pixel
navigation bars, eight-column emoji rows, five-column sticker rows, and scale transition follow
`tweb/src/scss/partials/_emojiDropdown.scss`.

- Hover opens temporarily; clicking keeps the picker open until dismissal. Search retains focus
  while insertion advances the saved composer caret. Backspace deletes one grapheme, including
  skin-tone and joined emoji sequences.
- Emoji Mart's Unicode 15 catalog and search index load on demand. Category rows are virtualized
  with TanStack Virtual. Recent emoji stay in place during a browsing session; the next opening
  reflects newly used emoji. Skin tone is saved per emoji and changing it does not insert text.
- Sticker clicks send; held presses preview and can slide across stickers. Releasing a preview
  does not send. Context menus expose local favorites and sticker-set viewing. Recents,
  favorites, and tones persist locally.
- `src/chat/stickers/` owns the local catalog and visibility-aware animation player. Animation
  requests are cached, but each player gets a separate copy because Lottie mutates its input.
  Players pause outside the viewport, when the window loses focus, in hidden documents, and
  with reduced motion enabled. One shared controller owns the browser event subscriptions.
  Resuming waits for the next animation frame so Lottie's suspended clock cannot include time
  spent in a hidden tab. Pausing preserves the current frame rather than restarting the sticker.
  Sticker-set dialogs pause background players; held previews take priority over the set and
  restore its playback scope on release. Closing the set restores normal chat/picker playback.
  Main menu → Stickers and Emoji exposes the persisted Loop Animated Stickers preference.
  Disabling it finishes the current lap and holds the last frame; focus changes do not replay
  completed stickers. Re-enabling it restarts completed players when playback is allowed.
  TGS files are decompressed with the browser DecompressionStream API. Most stickers use the
  lightweight Canvas player; assets with track mattes use SVG, selected explicitly in the catalog.
  Static previews cover loading and playback failures without replacing paused animation frames.
- Messages store stable catalog IDs in the existing sticker field, so reload and forwarding keep
  the same artwork. Demo fixtures also reference the current catalog.

The local snapshot contains Duck (40), Cubigator (30), and Shark Animated (48), downloaded as
original TGS files from the public Telegram packs on November 7, 2026. All 118 files retain their
512 × 512 vector canvas and 60 FPS timeline. The catalog uses Telegram file-unique IDs and emoji
metadata. WebP covers are first frames rendered locally at 100 × 100 pixels. Source links and
SHA-256 checksums are recorded in `public/assets/stickers/SOURCES.json`.

Online pack discovery, premium custom emoji, GIF search, scheduled sending, and Telegram's
worker-based animation renderer are not connected in this local demo. No bot token, API cache,
or Telegram login session is required at runtime or included in the project. The previous AVIF
exports and UI-animation sample packs have been removed; no legacy sticker catalog is retained.
