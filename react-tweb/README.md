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
- Keyboard-accessible menus, a searchable emoji palette, and local emoji stickers.
- Photo upload, paste, and drop into the composer; attachment preview and captions.
- Full-screen photo gallery with keyboard navigation and download.
- IndexedDB persistence for messages, text drafts, theme, and attached image data.
- Grouped bubble corners, entry animations, panel transitions, and reduced-motion support.

Right-click a message or use its more button to open its actions. On touch screens, the more
button remains visible. Images are limited to 8 MB each and are never uploaded to a server.

## Deliberate boundaries

This is a local conversation study, not an authenticated Telegram client. The contacts and messages
are invented demonstration content. The original account's private conversation data is not bundled.

Delivery marks indicate local messages, not real network delivery or read receipts. Calls, recording
voice messages, remote GIF search, network presence, rich-text entities, and Telegram account settings
are not implemented. Stickers use large native emoji rather than Telegram's animated sticker format.
The group information and mute control demonstrate local UI state; there is no notification service.

The history uses ordinary React rendering, which keeps the learning path clear. It is not an
unbounded virtualized timeline. Persistence writes complete snapshots and is intended for a small
local history. Text drafts persist; unsent image previews remain transient and are cleared when
switching conversations. Browser storage errors are reported in the interface.

## Dependencies and ownership

| Library                    | Responsibility                                           |
| -------------------------- | -------------------------------------------------------- |
| React                      | Component rendering, reducer state, lifecycle            |
| Ark UI                     | Menu, popover, dialog, tabs, keyboard and focus behavior |
| CSS Modules                | Component-scoped visual styles                           |
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
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). The sample landscape SVG is original to this study.
