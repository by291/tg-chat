# React Telegram Conversation Implementation Plan

> Execute inline using superpowers:executing-plans. The user requested autonomous implementation.

**Goal:** Deliver a runnable, readable React recreation of the Telegram conversation page.

**Architecture:** A single conversation domain owns its reducer, persistence, and UI. Ark UI supplies
accessible interaction primitives; CSS Modules and Motion reproduce the reference appearance.

**Tech Stack:** React, TypeScript, Vite, pnpm, Ark UI, Lucide, Motion, idb-keyval, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-react-tweb-design.md`

## Global Constraints

- Use the existing checkout and a new `react-tweb/` directory.
- Write readable English code with public function purpose comments and semantic whitespace.
- Format using Prettier, then run type checks, tests, a production build, and browser checks.
- Do not connect to Telegram or publish the application.

## Review Focus

- IME composition must not accidentally submit a message.
- Switching conversations must preserve drafts and scope edits to the correct conversation.
- Invalid saved state and failed storage writes must not crash the application.
- Image attachments must retain dimensions and survive reloads.
- Reply navigation, searching history, and opening side panels must preserve usable scroll behavior.

## Task 1: Conversation state and project foundation

Files: `react-tweb/package.json`, configuration files, and `src/chat/{model,fixtures,reducer,storage}`.
Interface: `ChatState`, `ChatAction`, `chatReducer(state, action)`, persisted state schema.

- [x] Create package scripts and install dependencies.
- [x] Write reducer behavior tests for sending, blank input, chat isolation, editing, and reactions.
- [x] Run the tests against a stub and verify expected assertion failures.
- [x] Implement the reducer, fixture content, and persistence validation.
- [x] Run `pnpm test` and confirm all state behavior tests pass.

## Task 2: Conversation UI

Files: `src/chat/ChatApp.tsx`, `ChatSidebar`, `ChatHeader`, `MessageTimeline`, `MessageBubble`,
`MessageComposer`, `ChatDetails`, `MediaViewer`, and adjacent CSS Modules.
Interface: UI components consume the model and dispatch `ChatAction` objects.

- [x] Implement the floating responsive shell and reference styling.
- [x] Implement Ark UI context menus, emoji popover, details tabs, and media dialog.
- [x] Implement send/reply/edit/delete/react/pin, local media upload, search, and draft restoration.
- [x] Verify composer keyboard behavior, scroll behavior, and conversation switching in the browser.

## Task 3: Verification and learning documentation

Files: `README.md`, `react-tweb/README.md`, `react-tweb/docs/source-guide.md`, attribution files.

- [x] Run Prettier, `pnpm test`, and `pnpm build`.
- [x] Verify desktop and mobile layouts, key interactions, and reload persistence.
- [x] Implement reduced-motion handling; OS preference switching was not manually verified.
- [x] Request one independent final code review and resolve important findings.
- [x] Document source mapping, architecture, commands, and concrete limitations.

## Execution Ledger

- Repository inspected: empty checkout on unborn main; no existing implementation to preserve.
- User selected local demonstration and explicitly requested direct autonomous work.
- Ruling: use this checkout without a new worktree; the user requested this project directory.
- Ruling: keep work uncommitted for inspection; no commit or publication was requested.

- Validation completed on November 6, 2026: production build, 19 tests across five files,
  and formatter checks passed.
- Independent review findings resolved: preserve text drafts when sending stickers, prevent stale
  image decoding from replacing a newer selection, expose keyboard-accessible reaction commands,
  reject invalid Date timestamps, and allow removing an image caption while editing.
- Browser checks covered sending, editing, deleting, searching messages, inserting emoji,
  switching conversations with drafts, opening media and details, and reload persistence.
- Responsive navigation was checked at 390 by 844 pixels and restored to desktop afterward.
- Real file selection remains a manual verification gap: the extension blocked file injection,
  and the native chooser did not enable Open for the selected screenshot. Decoder race behavior
  is covered by component tests; no successful browser upload is claimed.
- Preview remains available at http://127.0.0.1:5173/.
- Desktop proof image: react-tweb/docs/screenshots/desktop.jpg.
