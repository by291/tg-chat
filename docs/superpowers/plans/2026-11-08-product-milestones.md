# TG Chat product roadmap

The [approved product design][product] defines the product target and
[release acceptance scenarios][scenarios]. Current behavior and repeatable checks live in the
topic guides below. M10 remains deferred.

## Implemented milestones

- M1 runtime and API contracts. [Development](../../development.md) and
  [operations](../../operations.md).
- M2 accounts, sessions, contacts, and recovery. [Accounts](../../accounts.md).
- M3 durable direct messages. [Message acceptance][message-acceptance].
- M4 realtime and multi-device convergence. [Browser durability][browser-durability].
- M5 groups, channels, and discovery. [Communities](../../communities.md).
- M6 private media and recorded voice. [Private media](../../media.md).
- M7 message interactions and history discovery. [Structured messages][interactions] and
  [search and previews][search].
- M8 notifications, moderation, and account lifecycle. [Notifications][notifications],
  [operator authority][operators], [evidence](../../media.md#report-evidence), and
  [account deletion](../../accounts.md#account-deletion).
- M9 one-to-one voice and video calls. [Calls](../../calls.md).

## Outstanding capability checks

- [ ] M6: Verify microphone permission, recording, cancellation, and playback on physical iOS
      Safari and Android Chrome. See [connected media checks][mobile-media].
- [ ] M8: Verify delivery through a real Web Push provider and system notifications on the target
      browser and OS. See [Web Push verification][push-verification].
- [ ] M9: Verify physical microphone and camera operation across distinct networks, including
      TURN relay selection. See the [M9 cross-network acceptance plan][m9-network].

## M10: Release, performance, and recovery acceptance

**Outcome:** The complete product can be deployed, upgraded, observed, backed up, and restored under
documented operating limits. This stage resolves measured failures; it does not invent new scope.

**Consumes:** All prior increments and their repeatable checks, deployment assets, and metrics.

**Produces:** Release/upgrade and recovery procedures, measured capacity results, bounded failure
behavior, browser capability record, and a complete product acceptance record tied to a revision.

- [ ] Complete deployment hardening: pinned images, secret/configuration handling, private service
      boundaries, explicit migrations, compatible upgrade/rollback procedure, and graceful shutdown.
- [ ] Exercise dependency outages, backlog limits, poison jobs, rate-limit-store loss, worker lease
      expiry, repeated restarts, and restoration of realtime after broker loss. Verify monitoring
      detects lag/capacity problems without recording secrets or message bodies.
- [ ] Measure the agreed workload: 1,000 accounts, 100 connected clients, 10 sends/second across 20
      conversations, separate 200-member/500-subscriber fanout cases, million-message history, and
      10 simultaneous one-to-one calls. Document hardware and do not combine independent maxima into
      an unverified claim. Tune configuration or fix bottlenecks before accepting the results.
- [ ] Run coordinated off-host PostgreSQL and RustFS backups and an isolated restore drill. Verify
      filer/object references, permissions, retained forwarded attachments, rotated sync epoch, and
      client reset. Demonstrate the one-hour RPO/four-hour RTO targets or explicitly report the gap.
- [ ] Verify desktop Chrome/Firefox/Safari/Edge, real iOS Safari and Android Chrome, touch/history
      behavior, voice formats, uploads, calls, and capability-dependent push. Record actual support
      rather than extrapolating the existing Chromium suite.
- [ ] Run all approved design acceptance scenarios against the release candidate, resolve failures,
      and consolidate lasting implementation/operations guidance into owning documents. Retain
      active plans; remove superseded work documents only in a requested consolidation.

**Exit gate:** Every design acceptance scenario has evidence at the candidate revision. Unsupported
capabilities and measured limitations are explicit. A successful local Compose launch or large unit
test count alone does not qualify as release readiness.

**Verification ownership:** All backend/browser suites, `scripts/` load/recovery tools, deployment
checks, and root operations/development documentation. Use `cargo test --all-targets`, Rustfmt,
Clippy, frontend unit/build/format checks, service-backed browser/integration suites, and the actual
restore/network drills after those tools exist. Never present this roadmap as results already run.

[product]: ../specs/2026-11-08-complete-product-design.md
[scenarios]: ../specs/2026-11-08-complete-product-design.md#16-verification-and-final-product-acceptance
[mobile-media]: ../../../web/docs/development.md#connected-media-capability-checks
[push-verification]: ../../development.md#web-push-verification
[m9-network]: ./2026-11-12-m9-livekit-calls.md
[message-acceptance]: ../../messaging.md#acceptance-and-ownership
[browser-durability]: ../../messaging.md#browser-durability-and-recovery
[interactions]: ../../messaging.md#structured-messages-and-forwarding
[search]: ../../messaging.md#search-and-link-previews
[notifications]: ../../messaging.md#live-activity-and-notifications
[operators]: ../../operations.md#trusted-account-administration
