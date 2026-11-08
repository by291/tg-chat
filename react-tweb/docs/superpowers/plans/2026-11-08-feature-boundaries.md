# Feature Boundaries Implementation Plan

**Goal:** Make large features navigable and separate components that currently own unrelated work.

**Authorization:** The user approved all recommendations from the source-organization follow-up.

**Architecture:** Group chat rendering and composition by behavior, extract the Lexical editor as
its own feature, and move generic overlays into components. Message and conversation contracts live
under domain; chat state and action contracts stay with state. Split orchestration by behavior while
preserving existing mounts, callback ordering, transient state, and interaction timing.

**Constraints:** No storage migration, new lazy boundaries, route change, dependency installation,
or automatic commit. Preserve user-visible behavior. Keep tests and styles beside their owners.
Use explicit imports rather than compatibility barrels. Existing behavior tests are the primary
regression gate; add coverage only for meaningful gaps exposed by the extractions.

## Tasks

- [x] Relocate message content, reactions, forwarding, selection, and transitions into named groups.
- [x] Separate composer attachments, forms, context, and picker modules; extract editor nodes,
      plugins, commands, toolbar, and serialization into `features/editor`.
- [x] Move generic menu dismissal and overlay styles into `components/overlays`.
- [x] Split the model into message/conversation domain contracts and chat state/action contracts;
      keep sanitization and custom emoji entities below feature rendering dependencies.
- [x] Separate formatting toolbar state, command/dialog handling, and presentation.
- [x] Extract conversation sending/editing/forwarding/deletion coordination by responsibility.
- [x] Extract sidebar list/search/archive views and their owned interactions.
- [x] Separate media geometry measurement and gesture mathematics from gesture orchestration.
- [x] Update source ownership documentation and verify all moved imports and dynamic boundaries.
- [x] Run targeted behavior suites, full tests, build, formatting, and browser checks.
- [x] Request a focused independent review and resolve substantive regressions.

## Verification focus

- Selection restoration across formatting dialogs and toolbar updates.
- Draft retention, forwarding cancellation, deleted/expired reply targets, and media-command returns.
- Search focus, archive navigation, settings exit transitions, and conversation creation.
- Viewer measurement, rotation bounds, pinch continuation, wheel settling, and cancellation.
- Persisted schema behavior, custom emoji offsets, sanitization, static assets, and lazy imports.

## Progress

- Baseline: clean checkout at `f463f27`; 96 suites and 485 tests passed before this work.

- Completed the ownership changes above without compatibility barrels or new loading boundaries.
- Initial regression run: 96 test files and 492 tests passed.
- TypeScript and production build passed; the existing large-chunk warning remains.
- Targeted media regression run: 13 test files and 95 tests passed.
- Independent source review found no blocking regressions in imports, schemas, callback ordering,
  component lifetimes, editor effects, media calculations, or overlay styles.
- Production-browser checks passed for bold formatting, link-dialog cancellation, image zoom and
  rotation, forwarding cancellation back to the viewer, and search dismissal back to the list.
  The temporary editor draft was cleared after verification.
- Fixed a new archive navigation test to await the destination before reading its controls;
  mocked theme artwork because asset decoding is outside the sidebar navigation behavior.
- Updated the README, source guide, and third-party source references.

## Commit preparation follow-up

The user requested grouped commits after implementation. During fresh verification, archive search
intermittently lost focus when route restoration finished after the search focus frame. A controlled
frame test reproduced the failure. The search hook now waits until the archive destination has
closed before scheduling input focus. Keep this behavior fix separate from the ownership refactor.

Final verification: 97 test files and 493 tests passed. TypeScript, the production build, Prettier,
and whitespace checks passed. The production build retains its existing large-chunk warning.
