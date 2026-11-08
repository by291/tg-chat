# Navigation, Preferences, and Motion Implementation Plan

**Goal:** Adopt React Router, Zustand preferences, and Motion interpolation without changing
the frontend's storage format or conversation behavior.

**Architecture:** React Router owns URL navigation while existing mounted panels own transitions
and scroll positions. Zustand owns preference snapshots and subscriptions, using the existing
validated localStorage records. Motion owns ordinary animated values; virtual history and
message geometry retain their existing coordination.

**Scope:** The user selected these three improvements after the source review and explicitly
deferred storage redesign and backend integration. Work stays on the current branch.

## Constraints

- Keep IndexedDB snapshots, localStorage keys, and saved JSON shapes compatible.
- Preserve existing reducer business rules, custom message flights, and virtual scroll ownership.
- Preserve settings search context, panel exit content, and legacy `?chat=` deep links.
- Use the project's Prettier configuration and readable English source and documentation.
- Verify actual behavior; do not add dependency-presence or implementation-mirroring tests.

## Task 1: URL navigation

- [x] Add failing behavior tests for chat selection, browser back/forward, direct links,
      unknown chats, and settings category navigation.
- [x] Add React Router and a navigation hook in `src/app/navigation/`.
- [x] Connect `ChatApp`, `ChatSidebar`, and `SettingsPage` without replacing panel lifetimes.
- [x] Keep unrelated search parameters and avoid duplicate history entries for the same destination.
- [x] Run navigation and existing sidebar/settings behavior tests.

## Task 2: Zustand preferences

- [x] Test selective subscription behavior and preserve existing reload, cross-tab, invalid-data,
      and storage-failure tests.
- [x] Introduce one validated preference-store adapter in `src/app/settings/`.
- [x] Migrate appearance, application, and notification preference snapshots to Zustand.
- [x] Keep imperative reader/setter APIs for playback and notification owners.
- [x] Subscribe hot rendering paths to individual fields instead of complete preferences.
- [x] Run preference and affected component tests.

## Task 3: Motion values

- [x] Update the poll-animation regression test to verify interruption, final values,
      restored results, reset, and reduced motion through observable animation values.
- [x] Move poll interpolation to Motion values and render those values without per-frame
      component state updates. Preserve choice/path/result timing and cancellation.
- [x] Run poll and existing animation regressions.

## Delivery

- [x] Update README and source guide with ownership changes.
- [x] Run the complete Vitest suite, TypeScript/Vite build, and Prettier checks.
- [x] Obtain an independent final review and address substantive findings.
- [x] Report verified results and any material limitations.

## Progress

- Source review complete; working tree initially clean.

- React Router, Zustand preferences, and Motion interpolation implemented.
- Preserved IndexedDB snapshots and all preference storage keys and JSON shapes.
- Browser checks passed for chat back/forward, nested settings reload and return, and invalid chats.
- Independent review identified explicit same-chat unread clearing and cross-chat media command
  ownership regressions. Both received failing behavioral tests and fixes; targeted tests pass.
- The reviewer found no current production caller issuing simultaneous URL writes; speculative
  batching redesign remains outside this change. Preference synchronization gaps without any
  subscribers are pre-existing and retain their previous behavior.
- Final verification after the review fixes: 94 test files and 471 tests passed; TypeScript/Vite
  build, Prettier checks, and `git diff --check` passed.
- Vite reports a bundle-size warning: the largest entry chunk is 1,181.93 kB before gzip.
