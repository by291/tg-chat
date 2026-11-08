# Source Organization Implementation Plan

> Execute this plan inline with the executing-plans skill and request one final focused review.

**Goal:** Make page assembly, layouts, business features, and shared infrastructure easy to locate.

**Architecture:** Keep the current single chat workspace and query-parameter navigation. Extract its
visual shell into a layout, keep orchestration in a page, and group related business UI and state
under named features. Components, styles, assets, and tests move together.

**Tech Stack:** React, TypeScript, Vite, React Router, Vitest, Prettier, pnpm.

**Spec:** The user's request to reorganize the project using responsibility-based directories,
including pages, layouts, components, and features where appropriate.

## Constraints

- Preserve UI behavior, routes, storage keys, demo content, and existing lazy-loading boundaries.
- Work in the current checkout and branch; commit only when the user requests it.
- Keep feature-specific hooks and models with their feature; move only generic hooks to `hooks`.
- Use direct imports and an `@/` source alias for cross-module dependencies; add no barrel modules.
- Reuse existing behavior tests; do not add tests that merely assert directory names or file moves.

## Target ownership

- `src/app/App.tsx`: router and application-wide input-modality setup.
- `src/pages/chat/ChatPage.tsx`: conversation selection, state, and cross-feature orchestration.
- `src/layouts/chat/`: responsive chat slots and the startup handoff.
- `src/layouts/sidebar/`: nested sidebar page transitions.
- `src/features/chat/`: messages, composer, timeline, details, state, model, and local fixtures.
- `src/features/conversations/`: conversation list, archive controls, and new conversation creation.
- `src/features/settings/`: settings panels, preferences, appearance, notifications, and devices.
- `src/features/media/`, `emoji/`, `stickers/`: their existing rendering and interaction modules.
- `src/components/`: generic reusable interface components.
- `src/hooks/`: input modality and retained dialog values.
- `src/lib/`: browser keyboard conventions and validated preference-store infrastructure.
- `src/routes/`: existing URL parsing and state synchronization.
- `src/styles/`: global tokens, reset, and cross-component styles.

## Steps

- [x] Record a complete relocation map and rewrite relative imports, dynamic imports, test mocks,
      CSS references, and JSON imports using their resolved original targets.
- [x] Add the source alias to TypeScript and Vite, then verify module resolution with the build.
- [x] Extract `ChatLayout` with background, sidebar, conversation, details, and overlay slots;
      retain the same DOM wrappers, data attributes, and CSS behavior.
- [x] Rename the workspace component to `ChatPage`, introduce application assembly, and retain
      the existing behavioral tests beside their new owners.
- [x] Update the README, current source guide, attribution links, and current audit references;
      retain historical plans as dated records of the old structure.
- [x] Run the complete test suite, production build, formatting, and whitespace checks.
- [x] Check startup, conversation selection, settings navigation, media viewer, and mobile layout
      in the production preview, then request a focused review of behavior and import boundaries.

## Review focus

- Dynamic module paths and test mocks still resolve after moving their owners.
- Pages and layouts retain message state, closing panels, and startup animation timing.
- Generic components and infrastructure do not acquire feature or page dependencies.
- CSS Modules shared by settings controls remain feature-owned rather than importing page styles.
- Existing route queries, persistence formats, public assets, and lazy imports remain unchanged.

## Progress

- Initial state: clean checkout at `f22de0f`; existing suite passed 485 tests before this refactor.

- Relocated 412 existing source files; components, styles, tests, and catalog JSON stayed together.
- Added application assembly and extracted the chat layout without changing its DOM structure.
- Verified resolved static imports, dynamic imports, and mock targets against the original modules.
- Full validation passed: 96 test files, 485 tests, TypeScript, and Vite production build.
- Existing bundle-size warning remains; directory reorganization does not change loading policy.
- Browser checks passed for deep-linked startup, media open/close, settings and general settings,
  details open/close, mobile back navigation, and conversation selection.
- At 390 by 844 pixels the sidebar retained left/top 8px, width 374px, and height 828px.
  Device emulation was cleared after verification.
- A focused independent source review found no blocking issues in rendering, module resolution,
  shared-layer dependencies, storage, or lazy-loading boundaries.
- The user requested a single checkpoint commit after implementation and review.
