# Test suite hardening

The user authorized fixing every finding in the preceding repository-wide test review.
The work strengthens existing behavior contracts without changing product requirements.

## Approach

Repair tests at their owning boundaries: independent fixtures for state tests, explicit rich-text
semantics in shared vectors, controlled clocks for local deadlines, database lock observation for
transaction races, and real browser/service checks for platform integrations.
Retain useful service, transport, owner, persistence, and browser coverage.

A broad test-framework rewrite would add migration risk without improving these contracts.
Increasing timeouts alone would retain the false positives and scheduling assumptions.

## Required outcomes

- Reducer tests remain independent when their execution order changes.
- Both canonical message implementations preserve supported rich structures and remove executable
  markup, using shared independently specified expectations.
- Account deletion and ownership-transfer races execute independently and observe their locks.
- Feed tests prove the competing writer is blocked before the original transaction commits.
- Browser reset tests require a fresh bootstrap and replacement of stale canonical state.
- Local expiry tests control time and assert both sides of each transition.
- Community tests observe a stable mute before checking deadline restoration.
- Wallpaper tests distinguish decoder failure, preparation, persistence failure, and real browser
  image preparation and restoration.
- Calls and provider contracts run in CI, and failed calls retain browser artifacts.
- Push lease takeover prevents stale completions from altering new work or removing subscriptions.
- Repeated account fixtures use existing shared helpers; independent connected workflows have
  independent setup where splitting materially improves fault isolation.
- Retain real Valkey expiry checks while removing avoidable waits from other state combinations.

## Constraints

Use the existing checkout and branch. Commit fixes by topic; do not publish or alter existing development
services. Use disposable services for integration verification. Commit related documentation with each topic.
Follow AGENTS.md, Rustfmt, and the existing Prettier configuration. Code-related text is English.
Do not add source-text assertions, test-only production methods, arbitrary sleeps, or blanket retries.
Physical devices, Safari/iOS, OS Push delivery, and cross-network TURN remain manual acceptance.
