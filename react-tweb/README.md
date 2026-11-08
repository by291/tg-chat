# Telegram Conversation, in React

A local learning project that recreates the floating conversation interface observed in
Telegram Web K. The implementation uses React components and explicit state transitions rather
than embedding the upstream Telegram renderer.

## Run

Use Node.js 22.22 or newer and pnpm 11.

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
- An unselected entry screen, URL-based chat/settings navigation with browser back and forward,
  and circular light/dark transitions.
- A floating creation menu with contact selection and locally persisted groups and channels.
- Compact profile actions, editable local information and members, and animated shared-content tabs.
- Conversation filtering and message search within the current conversation.
- Text messages, Shift+Enter newlines, and IME-safe Enter submission.
- Selection formatting, links, spoilers, dates, and expanded rich-text composition.
- Headings, lists, checklists, collapsible details, tables, code blocks, and LaTeX formulas.
- Independent conversation drafts, restored after switching or refreshing.
- Reply previews, double-click to reply, and navigation to the original message.
- Editing, deleting with confirmation, pinning, copying text, and toggling reactions.
- Keyboard-accessible menus, a categorized emoji picker, and local animated sticker packs.
- Attachment menu for photos, videos, documents, expanded articles, polls, and checklists.
- Structured poll/checklist dialogs with editable rows, validation, settings, and preserved drafts.
- Local multiple-answer voting, quizzes, deadlines, revoting, and persistent checklist completion.
- Photo paste and drop into the composer; attachment preview and captions.
- Clickable date capsules, transient sticky dates, and calendar navigation through virtual history.
- Persistent placeholder and overlapping microphone/send/edit icon transitions.
- Full-screen photo gallery with keyboard navigation and download.
- IndexedDB persistence for messages, text drafts, theme, and attached image data.
- Grouped bubble corners, panel transitions, and reduced-motion support.
- Text sends morph from the captured composer into the measured message bubble over 300ms.
  Background geometry and text move separately; the real bubble appears when the flight lands.
  Receiving messages and sending attachments use history scrolling without a text-flight copy.
- Measured virtual history with local older-message paging, stable reading anchors, and ID-based jumps.
- A Message lab conversation with 1,000 archived messages and a media showcase.
- Albums, regular and circular videos, voice playback, files, link previews, contacts, and local polls.
- Forward labels, service messages, code blocks, quotes, and media-overlay timestamps.

Right-click a message or use its more button to open its actions. On touch screens, the more
button remains visible. Attachments are limited to 8 MB each and are never uploaded to a server.
The microphone represents the empty composer state; recording remains unavailable. Poll and
checklist creation use simplified local forms, and music search requires a remote provider.

## Deliberate boundaries

This is a local conversation study, not an authenticated Telegram client. The contacts and messages
are invented demonstration content. The original account's private conversation data is not bundled.

Delivery marks indicate local messages, not real network delivery or read receipts. Calls, recording
voice messages, remote GIF search, network presence, rich-text entities, and Telegram account settings
are not implemented. Sticker packs use locally bundled original TGS animations and generated
WebP previews.
The group information and mute control demonstrate local UI state; there is no notification service.
New groups, channels, and profile edits remain on this device. Group calls display an explanation
instead of starting a network call. Reloading restores content and appearance without reopening the
previously selected conversation; an explicit `?chat=` link still opens its destination.

The history uses TanStack Virtual to bound mounted rows. Older pages currently come from the local
in-memory conversation; this is not remote history pagination. Persistence still writes complete
snapshots, so the bounded DOM does not imply bounded application storage. Text drafts persist; unsent image previews remain transient and are cleared when
switching conversations. Browser storage errors are reported in the interface.

Polls and checklists use this device as the only participant. Permissions are stored and enforced
locally; no Telegram server or Premium subscription is involved. Poll descriptions and explanations
currently support plain text; embedded poll media and the custom end-date picker are not implemented.

## Dependencies and ownership

The source separates application assembly (`src/app`), workspace orchestration (`src/pages`),
visual shells (`src/layouts`), and business modules (`src/features`). Features cover chat,
conversation lists, settings, media, emoji, and stickers. Reusable UI stays in `src/components`;
generic hooks, browser infrastructure, navigation, and global styles have their own directories.
Components, CSS Modules, and related tests stay together. Cross-module imports use the `@/` source
alias. See the [directory layout](./docs/source-guide.md#directory-layout) for ownership and imports.

| Library                         | Responsibility                                                       |
| ------------------------------- | -------------------------------------------------------------------- |
| React                           | Component rendering, conversation reducer, lifecycle                 |
| React Router                    | Chat, archive, and settings URLs with browser history                |
| Zustand                         | Validated preference snapshots and selective subscriptions           |
| Ark UI                          | Menu, popover, dialog, tabs, keyboard and focus behavior             |
| CSS Modules                     | Component-scoped visual styles                                       |
| TanStack Virtual                | Dynamic row measurements, end anchoring, and bounded DOM             |
| Motion                          | Control transitions, poll-result values, easing, reduced motion      |
| Lucide                          | Consistent interface icons                                           |
| idb-keyval                      | IndexedDB access                                                     |
| Zod                             | Validation before restoring saved state                              |
| Lexical                         | Rich editing, atomic emoji, selection, history, and HTML interchange |
| DOMPurify and HTML React Parser | Safe semantic message content and React rendering                    |
| KaTeX                           | Bounded formula rendering in composition and messages                |
| Vitest and Testing Library      | State, keyboard, menu, and attachment regression tests               |

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

`src/features/chat/composer/emoticons/` owns the picker browsing behavior. Ark UI manages the popover,
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
- `src/features/stickers/` owns the local catalog and visibility-aware animation player. Animation
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

Online pack discovery, Telegram Premium entitlement checks, GIF search, scheduled sending, and Telegram's
worker-based animation renderer are not connected in this local demo. No bot token, API cache,
or Telegram login session is required at runtime or included in the project. The previous AVIF
exports and UI-animation sample packs have been removed; no legacy sticker catalog is retained.

### Local custom emoji

The Emoji tab includes Face Emoji (56), Hand Emoji (64), and Gold Utya (200). These are
original Telegram TGS documents, not Unicode font substitutions. The search field also uses
Telegram's 11 original animated emotion category icons. `public/assets/emoji/SOURCES.json`
records public source links, retrieval date, and checksums for animations and generated previews.

- `src/features/emoji/` owns document lookup, UTF-16 entity ranges, and inline message rendering.
- `EmojiEditor` uses Lexical for atomic emoji nodes, selection, composition, deletion and undo.
  The domain model stores plain text, `customEmoji` ranges, and optional semantic `richText` HTML;
  it does not persist editor JSON.
  Draft ranges are saved independently for each chat alongside the existing draft strings.
- Sending and editing trim text and shift emoji ranges together. Forwarding preserves document
  IDs, and reload restores both sent messages and unsent custom emoji. Unicode fallback text
  remains available to search, previews and plain-text clipboard operations.
- Packs share the existing virtual grid, search filters, recents and visibility-aware TGS player.
  Only visible rows decode animations. Emoji use the same window-focus, reduced-motion and
  looping policy as stickers; they do not introduce additional animation timers.

These packs are bundled for the local study. Runtime code does not call Telegram or require a
bot token, account login, or subscription. Artwork attribution is in `THIRD_PARTY_NOTICES.md`.

### Rich-text composition

Selecting text reveals a formatting toolbar. The expanded composer adds history controls,
block styles, lists, tables, code language, formulas, and dividers. On macOS use Command;
elsewhere use Control with B, I, U, S, M, P, or K for bold, italic, underline, strikethrough,
monospace, spoiler, or link editing. Enter sends; Shift+Enter inserts a newline and continues
structured list items. Formula and date decorations can be reopened with a double click.

`src/features/chat/composer/richEditorHtml.ts` adapts Lexical HTML to the portable message attributes.
`src/features/chat/rich-text/` sanitizes that content and renders interactive spoilers, custom emoji,
formulas, dates, tables, and copyable code. Drafts, edits, forwarding, and reload preserve the
same representation. The plain-text fallback remains available to search and chat previews.

Bubble block spacing and table presentation follow tweb's `instantView.module.scss` and
`genericTable.module.scss`. The final paragraph shares the bubble's inline formatting context
so the timestamp can stay beside short formatted text. Table borders and header fills derive
from the incoming or outgoing bubble colors. Saved checklist states are currently read-only;
change them through message editing rather than directly toggling the sent checklist.

This is local composition and rendering, without Telegram server entity serialization,
Premium entitlement enforcement, collaborative editing, or an AI action.
