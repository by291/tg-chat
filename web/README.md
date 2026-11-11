# TG Chat Web

TG Chat Web is the React frontend for TG Chat. It provides a Telegram-inspired conversation
interface with local data, persistent drafts, rich composition, media playback, and appearance
settings. Connected mode provides real accounts, privacy, devices, contacts, recovery, and durable
direct/Saved and community rich-text messages with pending-send recovery and bounded history.
The package is named `tg-chat-web`.

## Run

Use Node.js 22.22 or newer and pnpm 11. From this directory:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the address printed by Vite. For build and test commands, see
[development](./docs/development.md).

This command opens the standalone demo. To use real accounts, start the Rust services and run
`VITE_APP_MODE=connected pnpm dev --port 5173`. Match the backend's `TG_CHAT_PUBLIC_ORIGIN` to
`http://127.0.0.1:5173`; Vite proxies API requests to the backend. Docker builds connected mode
automatically. [Backend development](../docs/development.md) documents the complete setup and SMTP.

## Capabilities

- Conversations: inbox and archive, pinned ordering, local groups/channels, profile details,
  mute preferences, and browser-history navigation.
- Messages: replies, edits, reactions, selection, forwarding, pins, search, calendar navigation,
  and a virtualized history that preserves the reading position.
- Composition: per-conversation drafts, IME-safe input, rich text, links, spoilers, lists, tables,
  code, formulas, custom emoji, and animated stickers.
- Attachments: photo paste/drop, captions, documents, polls, and checklists with structured forms.
- Media: galleries, zoom and pan, video controls, voice playback, and visibility-aware animation.
- Appearance: responsive layouts, theme modes, local wallpapers, custom backgrounds, and reduced
  motion support.
- Local preferences: notifications while the app is open, sounds, playback, and appearance settings.

## Current scope

Connected accounts use server-owned profiles, privacy, device sessions, directional contacts, blocks,
and optional verified-email recovery. Private account results stay in memory, with ownership fences
and cross-tab invalidation. The explicit `/demo` route does not import that account into sample data.

Demo conversations use sample content and changes stay on this device. There is no Telegram login or remote push service. Delivery
marks, poll participation, checklist permissions, and profile edits represent local state.
When enabled, connected media supports resumable attachments, recorded voice messages, private
playback, and avatar uploads. Calls and remote media discovery remain later milestones.
See [private media](../docs/media.md) for setup and behavior.

Rich text uses sanitized semantic HTML rather than a Telegram server entity format. Bundled emoji
and sticker packs work without an account. Asset provenance and licenses are recorded in
[third-party notices](./THIRD_PARTY_NOTICES.md) and the bundled source manifests.

Messages and drafts persist in IndexedDB; application preferences use validated localStorage
values. Unsent attachment previews are temporary. One browser tab is the supported editing owner;
conversation snapshots do not merge concurrent edits from multiple tabs. Storage failures are
reported in the interface. The current storage design remains sufficient for frontend development;
connected pending recovery has its own ownership boundary. These demo persistence rules do not apply to
connected account data. See [accounts and recovery](../docs/accounts.md) and
[durable messaging](../docs/messaging.md) for the connected ownership boundaries.

## Design documents

Start with [architecture](./docs/architecture.md) for the overall design. Continue by topic:

- [Startup and appearance](./docs/startup-and-appearance.md)
- [Messages and history](./docs/message-history.md)
- [Editing and interactions](./docs/editing-and-interactions.md)
- [Development and verification](./docs/development.md)

The frontend is distributed under [GPL-3.0](./LICENSE). The browser icon is maintained in
`public/favicon.svg`, with an ICO companion for browser compatibility.

## Connected synchronization

Connected mode supports direct/Saved text and rich messages, edit conflicts, replies, reactions, pins,
read receipts, synchronized drafts, and personal conversation controls. Canonical state and its cursor
commit atomically in IndexedDB; pending sends and uncertain actions survive a canonical reset.
Centrifugo wakes HTTP catch-up, with polling/focus recovery when notifications are lost. See
[durable messaging](../docs/messaging.md) for ownership, authorization, and retention constraints.

Run `pnpm test:accounts` for existing account/message workflows and `pnpm test:sync` for four-session
convergence. They have separate artifact directories. Use the root isolated Compose verification for
independent admission fixtures; running both against one already-used local IP may legitimately hit
registration limits. Do not weaken product rate limits to make tests pass.

Connected communities support creation, public discovery, invitations, approval requests, role and
member management, and private group/channel history. Owner and administrator controls follow server
permissions; channel subscribers cannot publish. See [communities](../docs/communities.md) for the
authorization contract and `pnpm test:communities` for real multi-account browser verification.
