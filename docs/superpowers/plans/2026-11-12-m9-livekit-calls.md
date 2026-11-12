# M9 cross-network call acceptance

**Status:** Pending. The [call design](../../calls.md) is implemented. Use the
[isolated runtime check](../../development.md#call-verification) for repeatable browser
and provider regressions.

## Environment

Use two physical devices on distinct networks, such as Wi-Fi and cellular. Configure
the deployment with trusted TLS, reachable advertised addresses, and the selected RTC and
TURN transports. See [LiveKit deployment settings](../../operations.md#livekit-calls).

## Acceptance

- [ ] Complete voice and video in both directions using physical microphones and cameras.
      Exercise permission refusal, device switching, mute, and reconnect after a network change.
- [ ] Verify TURN fallback on a network that needs a relay. Confirm that the selected ICE
      candidate pair uses a relay candidate and that media works in both directions.
- [ ] Confirm terminal signaling rejects old credentials and observe when admitted media
      disconnects during provider cleanup.
- [ ] Record the candidate revision, LiveKit version, device/browser/OS, network and relay
      conditions, observed cleanup behavior, and outcomes. Update the
      [roadmap gate][roadmap] after the checks pass.

[roadmap]: ./2026-11-08-product-milestones.md#outstanding-capability-checks
