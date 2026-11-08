# Code Readability Review Plan

**Goal:** Review the entire authored frontend against the global engineering instructions, improve
readability without changing product behavior, verify the result, and commit by responsibility.

**Architecture:** Preserve module boundaries, storage formats, loading policy, and interaction
lifetimes. Group work by independent feature ownership, then review shared interfaces together.

**Tech Stack:** TypeScript, React, Prettier, Vitest, and Playwright.

**Spec:** The user's global engineering instructions and request for a project-wide readability
review, with particular attention to semantic blank lines and meaningful comments.

## Constraints

- Keep the current checkout and branch. Use English code, comments, and Conventional Commits.
- Review authored source, tests, scripts, and configuration; exclude generated and vendor assets.
- Preserve behavior and use the existing formatter. Avoid arbitrary line-count splits.
- Explain exported functions and non-obvious ordering, cancellation, and ownership decisions.
- Group preparation, validation, and execution semantically; do not add an empty line mechanically
  between every statement or write comments that merely restate the next line.
- Check naming, nesting, chained calls, positional booleans, excessive parameters, and multiline
  literals alongside comments and spacing. Keep framework-mandated signatures intact.
- Use existing behavioral tests for refactoring. Do not add tests that merely record formatting.

## Work groups

- [x] Review settings and conversation-list code, with colocated tests.
- [x] Review chat composition, message rendering, state, details, and conversation orchestration.
- [x] Review history, media viewing, and editor code, with colocated tests.
- [x] Review domain, shared UI/utilities, emoji/stickers, app/layout/routes, browser tests, and config.
- [x] Review cross-module interfaces and all remaining instruction violations; format changed files.
- [x] Run unit/component tests, TypeScript/build, browser regressions, and formatting checks.
- [x] Inspect the final diff and commit coherent groups, then verify the working tree.

## Review focus

Preserve hook order, closure captures, asynchronous cancellation, editor selection, scroll ownership,
and API-required argument shapes. Naming changes must update every caller without altering serialized
keys. Comments should describe why an invariant exists, not infer behavior from a function's name.

## Verification

Use static inventory and per-file review to cover instruction compliance. Use the existing full
Vitest suite, production build, and Chromium suite to detect behavioral changes. Verify Prettier
and whitespace after all edits. Keep temporary audit tooling outside the repository.

## Review result

Reviewed all authored source and tests by owner, including startup markup and tool configuration.
The final AST inventory covered 402 TypeScript files. Most edits preserve the normalized syntax;
structural changes are limited to equivalent branch, schema, type, constant, and callback cleanup.
Independent review found no remaining actionable regression.

Validation completed with 532 unit/component tests, nine Chromium cases, TypeScript/production
build, Prettier, and whitespace checks. The pre-existing large-bundle warning remains unchanged.
Temporary audit scripts and logs stay outside the repository.
