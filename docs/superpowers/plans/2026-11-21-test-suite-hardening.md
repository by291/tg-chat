# Test suite hardening implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve all actionable findings from the repository-wide test review.

**Architecture:** Strengthen existing test contracts at their owning boundaries. Preserve real
service integration and browser behavior checks while making fixture state and concurrency explicit.

**Tech Stack:** Rust, SQLx, PostgreSQL, Valkey, TypeScript, Vitest, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-21-test-suite-hardening-design.md`

## Global Constraints

- Use the current checkout and branch; commit fixes and related documentation by topic.
- Follow AGENTS.md, Rustfmt, and the existing Prettier configuration.
- Code-related text is English; user-facing explanations are Chinese.
- Use disposable services; do not alter existing development services.
- Test observable behavior; do not add source-text assertions or test-only production methods.

## Review Focus

- A stale asynchronous completion must not replace a newer identity, lease, or canonical snapshot.
- Shared fixtures must remain independent when cases run in a different order.
- Legitimate rich formatting must survive both wire-format implementations.
- Test setup must finish before controlled deadline transitions begin.
- Failed browser checks must retain artifacts after disposable containers are removed.

### Task 1: Frontend fixture and deadline isolation

**Files:** `web/src/features/chat/state/reducer.test.ts`,
`web/src/features/chat/data/ChatOwner.test.ts`, poll animation tests, and weak layout/cache tests.

**Interfaces:** No product interfaces change.

- [x] Reproduce the reducer failure with `--sequence.shuffle --sequence.seed=1`.
- [x] Create fresh mutable message fixtures and verify shuffled execution passes.
- [x] Control expiry and animation clocks; assert state before and after each deadline.
- [x] Make resize and cache-eviction tests actually change their relevant inputs.
- [x] Run `pnpm --dir web test --sequence.shuffle --sequence.seed=1`.
      Expected: every Vitest case passes.

### Task 2: Rich-text and wallpaper contracts

**Files:** `contracts/message-content.json`, both message-content tests,
wallpaper preparation/settings tests, and a browser wallpaper spec.

**Interfaces:** Shared fixture expectations are consumed by Rust and TypeScript tests.

- [x] Specify expected supported semantic HTML independently of either implementation.
- [x] Assert positive preservation and negative sanitization in both contract consumers.
- [x] Add explicit decoder, encoding, resource-release, and storage-failure coverage.
- [x] Add real browser upload, preparation, persistence, and reload verification.
- [x] Verify realistic mutations fail, restore production code, and run both contract suites.
      Expected: mutations fail the intended assertions; restored implementations pass.

### Task 3: Backend race and lease contracts

**Files:** `tests/account_lifecycle.rs`, `tests/sync.rs`, `tests/notifications.rs`,
shared support and repeated account fixtures, and activity expiry tests.

**Interfaces:** Shared test helpers only; production changes require a failing behavior test.

- [x] Observe database lock waits before checking competing transaction results.
- [x] Separate account creation/deletion from ownership-transfer/deletion races.
- [x] Add controlled Push transport completions around lease expiry and takeover.
- [x] Reuse existing account helpers and retain real Valkey TTL acceptance.
- [x] Run the changed tests against disposable PostgreSQL and Valkey.
      Expected: all changed integration cases pass without scheduling-dependent skips.

### Task 4: Connected browser recovery and workflow isolation

**Files:** `web/e2e-accounts/synchronization.spec.ts`, `communities.spec.ts`,
and connected test support where genuine preparation is shared.

**Interfaces:** Existing API routes and browser fixtures.

- [x] Reject the old cursor until fresh bootstrap and verify changed canonical state.
- [x] Separate stable mute observation from controlled expiry restoration.
- [x] Split independent scenarios and share meaningful account/context preparation.
- [x] Run connected projects through the disposable runtime.
      Expected: required recovery, moderation, and independent workflows pass.

### Task 5: Calls CI and retained diagnostics

**Files:** `.github/workflows/backend.yml`, `deploy/Dockerfile`, `compose.yaml`,
`scripts/check-calls-runtime.mjs`,
`scripts/check-runtime.mjs`, calls Playwright config, package scripts, and development guides.

**Interfaces:** Existing `check-runtime.mjs --calls` entry point.

- [x] Include app calls and both provider contracts in the calls-enabled verification.
- [x] Mount a dedicated writable result directory and retain failure traces/screenshots.
- [x] Add a separate calls CI job and preserve its artifacts on failure.
- [x] Verify real provider contracts, test discovery, and artifact persistence; record full-runtime limits.
      Expected: provider contracts pass; both browser cases are selected; outputs survive container cleanup.

### Task 6: Final verification and review

**Files:** All changed files and topic development documentation.

**Interfaces:** Existing developer commands remain usable.

- [x] Run formatting, frontend build, normal and shuffled Vitest, and demo browsers.
- [x] Run Rust checks and all supported integration cases with isolated services.
- [x] Review the full change set in a fresh reviewer context and fix material findings.
- [x] Record completed checks and any physical/platform acceptance limits.
      Expected: automated checks pass and no material review findings remain.

## Verification limits

The native suite ran with real isolated PostgreSQL, Valkey, SMTP, S3, and LiveKit. Connected
synchronization, reset, group, and channel workflows ran against native API/Worker processes with
HTTP catch-up. The provider browser contract also ran inside LiveKit's Linux network namespace.
A forced provider rejection left its trace and screenshot on the host after container removal.

Full application Compose acceptance was not run locally: this host uses Docker Engine 27.5.1,
while the named fetcher interfaces require Engine 28.1 or newer. The CI matrix now includes both
ordinary and calls-enabled acceptance on its explicitly configured supported Docker version.
