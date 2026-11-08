# Virtual History and Message Variants Implementation Plan

> Execute inline with superpowers:executing-plans; the user authorized direct implementation.

**Goal:** Add stable virtual history and Telegram-style message-specific bubble layouts.

**Architecture:** TanStack Virtual owns measurements and scroll corrections. A local history window
controls available rows. Message content renderers share the existing bubble shell and reducer.

**Tech Stack:** Existing React, Ark UI, CSS Modules, Motion, Vitest; add TanStack Virtual.

**Spec:** `docs/superpowers/specs/2026-11-06-virtual-history-design.md`

## Global Constraints

- Work in the existing checkout and retain current formatting and feature organization.
- Preserve saved conversations; do not publish, push, or modify the reference repositories.
- Keep the new changes uncommitted until the user requests the next checkpoint.

## Review Focus

- Prepend and deletion must not cause the reading anchor to move.
- Search and reply navigation must work for rows outside the mounted range.
- Media decoding and viewport resizing must not invalidate the visible position.
- Virtual remounting must not replay entry animations or leak media playback.
- Old persisted messages must restore without losing edits, drafts, or deletions.

## Task 1: Message content and local history model

Files: `model.ts`, `messageMedia.ts`, `mediaGeometry.ts`, `historyRows.ts`,
`historyFixtures.ts`, `fixtures.ts`, `storage.ts`, `reducer.ts`, adjacent tests.

Interfaces: `Message.media`, `createHistoryRows(messages)`, `getMediaGeometry(options)`,
`createHistoryMessages()`, and the `vote` reducer action.

- [x] Write failing behavior tests for geometry, date/group boundaries, old storage, and poll votes.
- [x] Add discriminated media schemas, backward-compatible upgrade, and deterministic history.
- [x] Run targeted tests; expect every behavior test to pass.

## Task 2: Virtual history and bubble presentation

Files: `useVirtualHistory.ts`, `MessageTimeline.tsx`, `MessageBubble.tsx`,
`MessageBody.tsx`, media renderers, and adjacent CSS Modules.

Interfaces: history rows supply stable keys and grouping; bubble renderers consume Message;
the existing conversation commands remain available and poll selection dispatches `vote`.

- [x] Write failing tests for older history expansion and navigation to unloaded messages.
- [x] Integrate stable keys, dynamic measurement, local paging, and index-based navigation.
- [x] Split bubble shell from content; implement media, forward, service, and metadata variants.
- [x] Run targeted component tests, then type-check and inspect the browser.

## Task 3: Verification and documentation

- [x] Verify real desktop/mobile scrolling, bounded DOM, anchor stability, and distant navigation.
- [x] Run an independent final review and fix correctness findings.
- [x] Run format check, full tests, and build; document references and actual verification limits.

## Execution Ledger

- Baseline: f21d21b; working tree clean before this request.
- Reference: tweb getViewportSlice uses two viewport heights of extra content (at least 1400px),
  and ScrollSaver restores a surviving visible element after mutations.
- Reference: virtual-demo uses TanStack Virtual end anchoring, persistent IDs, and media metadata.
- Ruling: retain local data in memory while paging the rendered history; backend paging is separate.
- Pre-flight: Task 2 consumes Task 1 schemas and row metadata; no conflicting interface ownership.

- Task 1 complete: media geometry, history row boundaries, storage compatibility, and poll
  transitions passed their targeted behavior checks.
- Task 2 complete: measured virtual rows, local paging, shared bubble chrome, media variants,
  album navigation, and playback visibility are implemented.
- Independent review identified resize anchor loss and filtered reply lookup; both were fixed.
- Browser verification additionally found the initial-scroll/navigation race and Strict Mode
  initialization issue; targeted virtualizer tests now cover both behaviors.
- Task 3 complete: 35 tests, production build, formatting, and targeted browser checks recorded
  in web/docs/virtual-history-verification.md.
- Ruling: native video controls and local poll voting remain explicit frontend boundaries; reproducing
  the entire Telegram media runtime would obscure the requested React architecture comparison.
- No new commit, push, or publication was performed in this iteration.
