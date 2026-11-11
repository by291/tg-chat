# M6 private media design

## Outcome

Users can send photos, photo and video albums, videos, documents, and recorded voice messages.
They can also update avatars through the same media pipeline. After Send, a pending bubble shows
progress immediately after local persistence. A reload or reopening the last tab in the same
browser session restores the bubble and continues the upload. The recipient sees the complete
message or album after the server accepts it.

The [product design][product-design] defines the private-media constraints. The
[milestone roadmap][roadmap] assigns forwarding, search, and link previews to M7. This milestone
covers recorded chat voice messages. Live calls are scheduled for M9.

[product-design]: 2026-11-08-complete-product-design.md#9-files-processing-and-link-previews
[roadmap]: ../plans/2026-11-08-product-milestones.md#m6-private-media-and-recorded-voice-messages

## Approach

Use the existing IndexedDB send queue, direct RustFS S3 uploads, and PostgreSQL-backed Worker
jobs. This preserves the Telegram-style split between file transfer, preparation, and message
publication. S3 multipart provides checkpoints for larger files. Small files use a single PUT
and retry that request after interruption. An API-proxied resumable protocol could use smaller
checkpoints at the cost of moving upload traffic and an additional protocol through our API.

The default album is one message with up to ten ordered photos and videos and one caption. Each
attachment occurrence has a stable identity, including when the same file appears twice. Document
and voice messages use individual sends. This keeps albums compatible with the existing timeline,
message acceptance, and viewer without requiring a separate grouped-message protocol.
Captions remain editable through the existing versioned edit command. Replacing accepted media
requires sending a new message.

## Sending and recovery

1. Selection, paste, drop, and finished voice recordings enter the composer with local previews.
   On Send, commit the attachment Blobs and pending message together to IndexedDB before starting
   transfer. Use the existing deployment, account, and session scope. A storage failure leaves
   the selection and caption available for retry. Bound local queued bytes separately from history.
2. Show one pending bubble with upload and processing progress, plus retry and cancel actions.
   Its client message ID remains stable. Keep album order and caption in the pending record. Retry
   only the failed item and preserve finished items. Media work cannot stall independent text sends.
3. On reopen, load the pending record and reconcile each upload against the API. For multipart,
   reuse the upload reservation and the parts reported by S3, even if a successful part response
   was lost. Issue fresh signatures as needed. Retransmit missing parts and interrupted PUTs
   automatically. Use one active uploader per pending item across tabs, and make recovery safe if
   another tab takes over. If the original bytes are gone but the pending record survives, allow
   reselection and reuse parts only after verifying that the bytes match the original fingerprint.
4. Once all items are ready, freeze the wire payload and submit it with the existing message
   identity. Check current posting authority and attach all references in the message transaction.
   The acceptance receipt or sync projection replaces the pending bubble. Reconciliation after a
   lost response reuses that same identity. Reuse the existing handling of uncertain cancellation.
5. Keep local Blobs while the message is pending so an expired upload can be replaced. Release
   them after acceptance or cancellation, on logout or revocation, and at the local byte-retention
   deadline. Server reservations and unreferenced ready files expire even if the browser disappears.

The normal resume case is reopening the same browser with the same authenticated session and
intact site storage. Uploads resume when the app opens. Small files whose PUT finished before a
lost response can be recovered by completion reconciliation. After a reservation expires, a
pending item with its original bytes can obtain a new reservation using the same message identity
before the wire payload is frozen. Once a send may have reached the server, reconcile that attempt
before changing any attachment reference. If the original attempt definitively failed and a file
has expired, preserve the caption and allow an explicit new send with fresh identities.

## Storage and processing

The API checks account and deployment budgets before reserving bytes and issuing short-lived,
size-bounded write signatures for private staging. Defaults remain 25 MiB per image, 100 MiB per
document or video, and 1 GiB of retained originals per account. Configure separate deployment
budgets for staging, originals, and variants, plus limits on active uploads and processing.
The API owns multipart creation, listing, completion, and abort. Reconcile ambiguous storage
responses before starting another transfer. The browser can write only its authorized object or
parts. Completion checks the stored size and queues processing idempotently.

The Worker copies staging bytes to a fresh server-only key for each attempt and validates the
actual copied bytes. A still-valid upload signature can overwrite staging during processing, so
the Worker verifies the candidate itself. Content inspection and derived metadata use bounded,
network-isolated processing with CPU, memory, time, dimension, and duration limits. Use maintained
S3 and media tooling. Generate image thumbnails, video posters and compatible playback variants,
and voice duration, waveform, and playable audio. Preserve the original for authorized download.
The current lease alone can publish validated originals and variants as ready. Rejected files
return an actionable reason. Transient storage and processing failures are retryable.

The browser records voice with a supported MediaRecorder format. The server normalizes it for
playback. Verify microphone permission, recording, cancellation, and playback on supported
desktop and mobile browsers. Publish authoritative geometry and duration with the media metadata
so message layout and viewer identity survive a reload and URL renewal.

## Access and retention

Authorize downloads through a visible message occurrence, a visible avatar reference, or the
uploader's pending item. For messages, reuse current membership, personal hide and clear state,
deletion, and expiry checks. Avatar references expose only the avatar variants. Sign private GET
URLs for one minute by default, serve them from a cookie-free media origin, and verify CORS and
Range behavior for playback. Renew expired URLs through the same authorization check. Previously
issued URLs remain usable until expiry. Serve active or unknown documents as safe downloads.

Message and avatar mutations write explicit file references under the same file lock that garbage
collection uses. A pending hold keeps a ready file alive until its first reference is committed or
the hold expires. Its lifetime from readiness covers the existing seven-day automatic send retry
window plus reconciliation grace. Replay an existing message receipt or identity binding before
requiring the ready files again. When the last reference and hold are gone, garbage collection
marks the file deleting before removing objects and retries interrupted deletions. Release quota
after cleanup. Reap abandoned multipart uploads, staging objects, and stale processing candidates
after a grace period covering outstanding write signatures and active attempts. Preserve live
references so M7 can add independent forwarding references. Back up PostgreSQL together with
the complete RustFS data volume under a coordinated consistency procedure.

## Acceptance

- Interrupt a large upload after some parts commit, close the last tab, and reopen the same chat.
  The original bubble resumes, confirmed parts are not retransmitted, and the receiver gets one
  complete message. Repeat with a lost part response and a lost message acceptance response.
- Verify small-file retry, one failed item in an album, session isolation, competing tabs,
  cancellation, expired reservations, quota exhaustion, and continued text sending.
- Exercise private upload and download, multipart reconciliation, CORS, Range, and cleanup against
  the pinned RustFS deployment. Verify revoked access prevents fresh URLs and check expiry.
- Verify staging overwrite, stale Worker completion, forged metadata, processing limits, missing
  objects, and concurrent reference creation and collection. Exercise voice and viewer playback
  in a browser and record the mobile compatibility results.

The implementation plan selects concrete client and processing libraries, API shapes, and tested
defaults for part sizing, retry windows, and processing limits.
