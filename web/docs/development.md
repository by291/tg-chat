# Development

## Local workflow

Use Node.js 22.22 or newer and pnpm 11. Run these commands from `web/`:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The main verification commands are:

```sh
pnpm test
pnpm build
pnpm format:check
pnpm exec playwright install chromium
pnpm test:browser
```

The build runs TypeScript checks before bundling. The browser suite builds production assets and
starts an isolated preview, with a fresh browser context per test. It does not reuse the regular
development server or its saved data. Failed cases retain traces and screenshots in `test-results/`.

Use the existing Prettier configuration. Text files use LF on Windows, macOS, and Linux through
Git attributes, EditorConfig, and Prettier; no global Git setting is needed. Binary assets are not
normalized. Root Markdown can be checked from `web/` with:

```sh
pnpm exec prettier --check ../README.md ../AGENTS.md
```

## Verify behavior at the owning boundary

Unit and component tests cover domain transitions, restoration validation, rich-text conversion,
attachment cancellation, form rules, preference changes, and input policies. Keep them close to the
owner and test observable behavior rather than private call counts or the shape of a refactor.

Browser tests cover behavior that depends on real focus, selection, layout, and scrolling. Existing
cases exercise archive search, formatting dialogs, viewer handoff, reading anchors, search keyboard
input, IME handling, and virtual calendar navigation.

Animation tests advance a controlled clock through movement, interruption, and completion. Layout
assertions wait for sustained stability rather than a single matching frame, because deferred
measurement can otherwise produce false passes. Production code and tests should share behavior
contracts, not duplicate each other's algorithms.

## Manual verification and limits

Changes to startup, appearance, native file input, and multi-touch gestures also need focused
browser checks. Exercise interruption and cancellation, reduced motion, narrow layouts, restoration
failure, and switching context while asynchronous work is pending. Confirm that ordinary actions
remain immediately available and unfinished input survives the intended panel transitions.

The automated browser configuration currently targets desktop Chromium. Responsive viewport checks
do not establish real touch-device behavior or Safari/iOS compatibility. The local frontend also
cannot verify remote delivery, backend synchronization, or concurrent multi-tab editing.

Choose checks according to the change. Documentation-only edits need formatting, link/reference
validation, and `git diff --check`; they do not require rerunning runtime suites. Report checks
actually run and their limits rather than retaining historical passing counts as guarantees.
