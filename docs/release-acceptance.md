# Release and capability acceptance

M1 through M9 have implemented feature increments. The checks below track remaining deployment
evidence. M10 is deferred. Use the [backend development guide](./development.md#repeatable-verification)
for the repeatable local suite and record the revision, environment, and measured results for any
release candidate.

## Outstanding browser capabilities

- [ ] Verify physical iOS Safari and Android Chrome recording, cancellation, and playback.
      See [connected media capability checks][mobile-media].
- [ ] Verify delivery through a real Web Push provider and system notifications on the target
      browser and OS. See [Web Push verification][push-verification].
- [ ] Complete the [M9 cross-network call checks](#m9-cross-network-call-acceptance).

## M9 cross-network call acceptance

**Status:** Pending. Use two physical devices on distinct networks, such as Wi-Fi and cellular.
Configure trusted TLS, reachable advertised addresses, and the selected RTC and TURN transports.
See [LiveKit deployment settings](./operations.md#livekit-calls) and the
[isolated call checks](./development.md#call-verification) for repeatable provider regressions.

- [ ] Complete voice and video in both directions using physical microphones and cameras.
      Exercise permission refusal, device switching, mute, and reconnect after a network change.
- [ ] Verify TURN fallback on a network that needs a relay. Inspect the selected ICE candidate pair
      for a relay candidate and confirm media works in both directions.
- [ ] Confirm terminal signaling rejects old credentials and observe when already admitted
      media disconnects during provider cleanup.
- [ ] Record the candidate revision, LiveKit version, browser, OS, devices, network and relay
      conditions, observed cleanup behavior, and outcomes.

## M10 release, performance, and recovery acceptance

**Status:** Deferred. The exit gate is evidence for each release scenario at the candidate
revision. Record measured limits and any unsupported capabilities.

- [ ] Verify pinned deployment assets, secrets, private ports, migrations, upgrade and rollback,
      and graceful shutdown. Confirm the supported schema compatibility window.
- [ ] Exercise PostgreSQL, Valkey, Centrifugo, and RustFS outages, backlog admission, poison jobs,
      lease expiry, and repeated restarts. Check monitoring for request latency and errors, database
      pool waits, job age and exhaustion, sync lag and resets, realtime reconnects, storage and
      quota growth, and media or call failures. Keep sensitive request data out of telemetry.
- [ ] Measure 1,000 registered accounts, 100 connected clients, and 10 accepted sends per second
      across 20 conversations. Run separate 200-member group and 500-subscriber channel fanout
      cases, a million-message history workload, and 10 simultaneous one-to-one calls. Record
      hardware, latency, throughput, and resource use for each scenario.
- [ ] Run an off-host PostgreSQL and RustFS backup and an isolated restore. Verify file references
      and permissions, retained forwarded attachments, sync epoch rotation, and client reset.
      Demonstrate the one-hour RPO and four-hour RTO targets or record the measured gap.
      See [persistence and recovery](./operations.md#persistence-and-recovery).
- [ ] Verify core chat on desktop Chrome, Firefox, Safari, and Edge. Exercise touch navigation,
      virtual history, voice formats, uploads, calls, and supported push on physical iOS Safari
      and Android Chrome. Record capability gaps for each environment.
- [ ] Run the release scenarios below, record evidence, and resolve any blocking failures.

### Release scenarios

- **Multi-device messaging.** Two registered users discover each other and exchange private
  files, replies, edits, and reactions. Verify read state across two devices per user.
- **Idempotency.** Drop a committed send response, restart the API, and retry. Verify one
  message and a conflict when reusing the operation with a different payload.
- **Convergence.** Reconnect after edits, deletes, membership changes, feed expiry, and Valkey
  loss. Concurrent cursor allocation, late history responses, and old tabs must preserve
  committed changes and deletions.
- **Membership and visibility.** Race joining, leaving, and bans with sends, search, downloads,
  and votes. Verify removed clients purge history and pre-issued URLs expire as documented.
  Exercise invitation approval, revocation, usage limits, ownership transfer, and personal
  archive, hide, and clear behavior.
- **Structured messages.** Verify vote counts under concurrent changes, quiz secrecy, checklist
  conflicts, and deadlines while the Worker is stopped.
- **Media and previews.** Interrupt multipart uploads and exercise processing failures, staging
  overwrite, and garbage-collection races. Verify that unvalidated bytes cannot be attached and
  live references survive. Exercise forged media types and rejected preview destinations.
- **History and drafts.** Load old pages and jump to distant replies, search results, and dates
  in large history. Exercise media browsing and Chinese search. Preserve reading anchors,
  concurrent drafts, and later typing during a send. Clear private caches and reject stale
  responses on logout or account switch.
- **Recovery and notifications.** Verify single-use email recovery and session revocation.
  Exercise push subscription revocation, duplicate suppression, mute, and read suppression with
  the chosen provider.
- **Calls.** Exercise two-device acceptance, simultaneous calls, cancel/accept races, permission
  refusal, refresh, reconnect, delayed webhooks, and revocation. Verify obsolete credentials and
  the physical TURN path.
- **Operations and capacity.** Restart API and Worker independently, observe and recover failed
  external work, and restore authorized history and files. Measure workload latency and bounded
  resource use.

[mobile-media]: ../web/docs/development.md#connected-media-capability-checks
[push-verification]: ./development.md#web-push-verification
