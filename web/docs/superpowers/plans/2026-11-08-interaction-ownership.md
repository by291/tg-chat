# Interaction Ownership Implementation Plan

> **For agentic workers:** Use executing-plans for integration and independent parallel tasks.

**Goal:** Finish the approved responsibility splits and add repeatable browser regressions.

**Architecture:** Keep state ownership local while extracting independent policies and input adapters.
The composer owns submission, the editor owns selection, the viewer owns transforms, and history
owns scroll coordination. Shared playback arbitration has no dependency on message rendering.

**Tech Stack:** React, TypeScript, Lexical, TanStack Virtual, use-gesture, Vitest, Playwright.

**Spec:** The user approved all six recommendations in the preceding source review.

## Global Constraints

- Preserve storage, routes, loading boundaries, animation timing, and user-visible behavior.
- Work on the existing branch without automatic commits.
- Use existing Prettier formatting and English code/documentation.
- Extract responsibilities rather than splitting files to satisfy a line count.
- Keep browser tests isolated from the user's development data.

## Review Focus

- Cancelled or superseded attachment decoding cannot restore stale previews.
- External draft replacement preserves ordinary typing and undo behavior.
- Pinch-to-pan continuation and interrupted wheel input retain one transform owner.
- History loading and read decisions respect navigation, resize, and page visibility.
- Browser focus, selection, scroll anchors, and viewer handoff survive real layout transitions.

## Tasks

- [x] Extract `useComposerAttachments` and attachment preview under composer/attachments;
      retain request ownership and use existing MessageComposer behavior tests.
- [x] Split editor value synchronization, input commands, and imperative controls beside EmojiEditor;
      preserve one shared selection reference and extend tests only for uncovered behavior.
- [x] Move audible playback arbitration to `lib/media`; separate viewer wheel and pointer adapters
      while retaining shared transform refs and cancellation in useViewerTransform.
- [x] Extract history read and pagination policy from useVirtualHistory; cover decision boundaries
      with pure tests and keep scroll/navigation/anchor coordination together.
- [x] Add Playwright configuration and independent browser cases for archive search focus,
      formatting-dialog selection restoration, viewer forwarding cancellation, and history anchors.
- [x] Update source ownership and test-running documentation.
- [x] Run targeted suites, full unit tests, type/build checks, formatting, and browser tests;
      inspect diffs and fix regressions before reporting completion.

## Results

- Composer attachment state and decoding now live in `useComposerAttachments`; the preview has its
  own component. Added behavioral coverage for removal, edit-mode retention, unmount, sending,
  document selection, and dropping after a document selection.
- Editor synchronization, input commands, and imperative controls have separate hooks while
  `EditorBridge` retains one selection reference and the original registration order.
- Playback arbitration lives in `lib/media/playback`. Pointer and wheel adapters share the viewer's
  transform/geometry owner; nested controls remain outside gesture ownership.
- `historyViewportPolicy` contains pure read and prefetch decisions; the history coordinator retains
  request ownership and all layout/scroll lifetimes.
- Added Playwright with production-build preview isolation, four real-browser regressions, retained
  failure artifacts, and separate Vitest discovery. Tests and configuration are type-checked.
- Full unit run: 99 files, 510 tests passed. Browser run: four Chromium cases repeated three times,
  all 12 executions passed. Production build and TypeScript passed with the existing chunk warning.
- Cross-reviews found no production regressions. The history browser test was corrected to observe
  actual scrolling rather than assume a fixture location, then strengthened to wait for sustained
  stable geometry across deferred resize correction before asserting its reading anchor.
- Test artifacts are excluded from formatting so transient trace files do not race with Prettier.
- README and source guide describe current ownership and browser test commands.
- The user requested grouped commits after reviewing the completed implementation.
