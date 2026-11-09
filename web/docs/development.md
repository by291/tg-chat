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

Connected browser tests use a separately running frontend, API, Worker, Valkey, and SMTP capture,
plus Centrifugo for realtime acceptance. Set `TG_CHAT_ACCOUNT_TEST_URL` and
`TG_CHAT_MAILPIT_TEST_URL`, then run `pnpm test:accounts`. They create isolated test identities and
exercise private profiles, contacts, device revocation, cross-tab logout, verification, single-use
recovery, direct/Saved rich messaging, pending reload, and history paging. Use a disposable
deployment with available registration rate budget. The root `node scripts/check-runtime.mjs`
command provisions that complete environment and runs Rust, account/messaging browser checks, and
committed-response-loss recovery; see [backend development](../../docs/development.md).

Use the existing Prettier configuration. Text files use LF on Windows, macOS, and Linux through
Git attributes, EditorConfig, and Prettier; no global Git setting is needed. Binary assets are not
normalized. Root Markdown can be checked from `web/` with:

```sh
pnpm exec prettier --check ../README.md ../AGENTS.md
```

## Continuous integration

[Web CI](../../.github/workflows/web.yml) runs for pull requests and pushes to `main` that affect
the frontend or its shared engineering configuration. It can also be started manually. New runs
cancel older work for the same branch or pull request.

Linux and Windows both install the locked dependencies and run unit/component tests. Windows runs
the type check and production build directly. Linux checks formatting and runs Chromium against a
production preview; that browser command already includes type checking and the build.

Node.js uses the supported 22 release line, while pnpm follows the version in `package.json`.
The dependency cache is keyed by the frontend lockfile. Browser failures retain screenshots and
traces as a workflow artifact for seven days. The workflow requires no project secrets and does
not publish or deploy the application.

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
do not establish real touch-device behavior or Safari/iOS compatibility. Demo tests cannot verify
backend message delivery, synchronization, or concurrent multi-tab editing. Account tests use real
local SMTP capture, which does not establish delivery through a public mail provider.

Choose checks according to the change. Documentation-only edits need formatting, link/reference
validation, and `git diff --check`; they do not require rerunning runtime suites. Report checks
actually run and their limits rather than retaining historical passing counts as guarantees.

`pnpm test:sync` exercises four sessions across two accounts plus a shared-cache tab. It checks
mixed lifecycle commands, read advancement, reply navigation, full reset preserving local input, and
deletion without resurrection after reload. Its output directory is separate from the demo and
account suites. Run it with independent admission fixtures; the root Compose runner resets only its
own ephemeral Valkey between suites rather than weakening application registration limits.

## Community acceptance

`pnpm test:communities` uses a disposable connected runtime from `TG_CHAT_ACCOUNT_TEST_URL`. Five
separate account contexts exercise public creation and discovery, administrator approval, retained
history, bans and access removal, private links, direct invitations, and read-only channel subscribers.
The suite records desktop and narrow-screen screenshots in its own artifact directory. The root
`node scripts/check-runtime.mjs` includes it after the account and synchronization suites, resetting
only that disposable project's admission fixtures between suites.
