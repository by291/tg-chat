# M6 Private Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship private attachments, albums, voice messages, and avatars with reload-safe sending.

**Architecture:** The browser transfers bytes directly to private S3 staging and persists pending
sends in IndexedDB. PostgreSQL owns reservations, processing leases, file references, and message
acceptance. The Worker validates immutable copies and produces variants before publication.

**Tech Stack:** Existing Axum, SQLx, PostgreSQL, SeaweedFS, React, IndexedDB, and Playwright.
Use the AWS SDK for Rust for S3, FFmpeg/ffprobe for processing, and Linux libseccomp for the
processor's network restriction. The browser uses XHR upload progress and MediaRecorder.

**Spec:** [Approved M6 design](../specs/2026-11-11-m6-private-media-design.md) and
[milestone acceptance][roadmap].

[roadmap]: 2026-11-08-product-milestones.md#m6-private-media-and-recorded-voice-messages

## Global constraints

- Continue on the existing checkout. Commit by responsibility using Conventional Commits.
- Keep 25 MiB per image, 100 MiB per document or video, and 1 GiB of retained originals per account.
- An album is one message with at most ten ordered photos or videos, one caption, and stable
  occurrence IDs. Documents and recorded voice messages are individual sends.
- GET signatures default to one minute. Ready holds cover the existing seven-day send retry
  window plus reconciliation grace. The browser keeps source bytes until terminal state or expiry.
- Preserve text-only request hashes, stored drafts, message identity, posting permissions, and
  the current cache and session fences. Demo behavior stays independent of connected mode.
- Keep S3 calls and codec processing outside business transactions. Preserve old migration files.
- Follow AGENTS.md, Rustfmt, and the existing frontend formatter. Use real PG for lock and race
  coverage, real SeaweedFS for S3 compatibility, and browser tests for recording and reopen.

## Starting defaults

- Single PUT at or below 8 MiB. Above that use numbered 8 MiB parts, with a shorter final part.
  Transfer at most two parts per file and four requests per browser session concurrently.
- Write signatures last 15 minutes. An idle reservation expires after 24 hours. A ready hold lasts
  eight days from publication. Retain local pending bytes for at most seven days and 512 MiB per
  session. Reconcile pending sends even after local bytes expire.
- Voice defaults to ten minutes and 25 MiB. Limit decoded images to 40 megapixels and video inputs
  to 3840 × 2160 and 30 minutes. Begin with one processing attempt per Worker at a time and three
  tries on transient failure. Cap each attempt at 120 seconds of wall time, 90 CPU seconds,
  768 MiB address space, and 150 MiB of variant output. Bound scratch space and diagnostic output.
- Configure staging, retained originals, and variants as separate deployment byte budgets. Seed
  isolated Compose defaults at 512 MiB, 1 GiB, and 512 MiB respectively, sized to its test workload.
  Validate these starting values on the pinned deployment. Document production overrides.

## File ownership

- `src/media/` owns upload contracts, storage adapter, processing, ready files, and collection.
  `src/bin/media-processor.rs` owns the subprocess execution boundary.
- `src/messages/`, `src/conversations/`, and `src/accounts/` own authorization and transactional
  references. `src/sync/` carries existing change projections. The S3 adapter sees object keys.
- `web/src/features/chat/data/` owns durable sends. `web/src/features/media/` owns transfer and
  short-lived URL handling. Existing composer, timeline, viewer, and profile UI render the states.
- `deploy/`, `compose.yaml`, and `scripts/check-runtime.mjs` own the real deployment checks.
  Rust types generate `openapi/api.json` and `web/src/api/schema.d.ts` through `pnpm api:generate`.

## Review focus

- A pre-signed PUT or part must reject bytes beyond its allocation at the actual media ingress.
- A lost S3 response must not create a second reservation or cause acknowledged parts to be resent.
- A matching send replay after file collection must return the prior identity without new writes.
- Revoked chat access and a late signing response must not repopulate the viewer or local cache.
- A late uploader tab or codec process must not publish after cancellation, expiry, or takeover.

## Task 1: Reserved transfer and S3 reconciliation

**Files:** Create `migrations/202611110001_media_uploads.sql`, `tests/media.rs`, and
`src/media/{mod,model,storage,uploads,http,settings}.rs`. Modify `src/{lib,http,runtime}.rs`,
`Cargo.toml`, `Cargo.lock`, `.env.example`, `compose.yaml`, `deploy/{s3.json,Caddyfile}`,
`scripts/{runtime-environment,check-runtime}.mjs`, and generated contracts.

**Interfaces:** `UploadService::reserve(&Actor, ReserveUpload) -> Result<UploadStatus, MediaError>`.
`ReserveUpload` carries client `upload_id`, `purpose`, `file_name`, `size_bytes`, and `sha256`.
`purpose` is `image`, `video`, `document`, `voice`, or `avatar`. `sha256` is lowercase hex.
`UploadStatus` carries `upload_id`, `state`, `expires_at`, `transfer_mode`, `part_size_bytes`, and
optional `file_id` or `error_code`. `TransferPlan` returns confirmed part numbers and signed PUT
requests with headers and expiry for the requested missing parts. Preserve one actor-owned upload
ID per reservation attempt. A fresh reservation after expiry uses a fresh upload ID.
States are `reserved`, `uploaded`, `processing`, `ready`, `rejected`, `cancelled`, and `expired`.
The transfer response has `single_put_complete` for the single PUT reconciliation case.

- [ ] Add `reservation_is_idempotent_and_quota_is_atomic` and
      `transfer_reconciles_lost_put_and_multipart_completion` in `tests/media.rs`. Race reservations
      at the 1 GiB account boundary, reject another actor and conflicting reuse, and verify a lost
      part acknowledgement and lost completion leave one completed upload. Add
      `signed_upload_rejects_oversized_body` against the real pinned ingress.
- [ ] Run `cargo test --locked --test media -- --include-ignored` with isolated PG and S3.
      Pass the isolated `DATABASE_URL`, `TG_CHAT_TEST_S3_ENDPOINT`,
      `TG_CHAT_TEST_S3_ACCESS_KEY`, and `TG_CHAT_TEST_S3_SECRET_KEY` into the test runner.
      Observe the tests fail for the missing behavior before implementing the path.
- [ ] Implement `/api/v1/media/uploads` POST, `/{upload_id}` GET and DELETE, and
      `/{upload_id}/transfer` and `/{upload_id}/complete` POST under the same prefix. Reuse
      authenticated cookie/Origin/CSRF and rate limits. Keep private bucket provisioning
      idempotent. Use separate internal and browser signing endpoints with path-style access.
      Pin compatible AWS SDK dependencies. Confirm that browser-generated Content-Length and
      ingress validation enforce the reserved size on both write paths. If the pinned S3 endpoint
      accepts an oversized signed write, enforce the bound on the dedicated media ingress before
      enabling writes. The media ingress must preserve the signed host and request headers.
      Completion uses server-side HEAD and ListParts, with exact expected
      numbers and lengths, ascending ETags, and HEAD reconciliation for uncertain completion.
      Serialize reservation transitions with bounded DB claims and reconcile S3 outside locks.
      The first migration owns the queue table so completion persists completed status and the
      processing job together. Cancellation stops new signatures. Keep a disabled-by-default
      media setting and expose availability through the existing capabilities response. Text and
      account routes stay up during an S3 outage. Enable media in Compose acceptance in Task 7.
- [ ] Rerun the isolated media tests, including real CORS preflight, object privacy, and abandoned
      multipart discovery after a lost create response. Run `pnpm --dir web api:generate` and
      `pnpm --dir web api:check`. Commit `feat(media): reserve and reconcile private uploads`.

## Task 2: Immutable preparation and bounded processing

**Files:** Create `migrations/202611110002_media_files.sql`, `src/media/{jobs,processing}.rs`,
`src/bin/media-processor.rs`, and `tests/media_jobs.rs`. Modify `src/runtime.rs`,
`deploy/Dockerfile`, and Worker configuration. Keep native macOS compilation and non-media tests
working. Run real codec and sandbox tests in Linux Compose.

**Interfaces:** `MediaWorker::run(CancellationToken)` claims preparation work with a lease token.
`MediaFileView` exposes `file_id`, `kind`, verified `size_bytes`, optional `width`, `height`,
`duration_ms`, and `waveform`, and available variant kinds. Stable kinds are `image`, `video`,
`document`, `voice`, and `avatar`. Variants are `original`, `thumbnail`, `poster`, and `playback`.

- [ ] Add `staging_overwrite_cannot_publish_unverified_bytes`,
      `stale_claim_cannot_replace_published_variants`, and
      `processor_rejects_exhaustion_and_external_io` in `tests/media_jobs.rs`. Cover forged type,
      size, and digest; a killed processor; over-limit metadata; and a child network attempt.
- [ ] Run `cargo test --locked --test media_jobs -- --include-ignored` in isolated Linux Compose.
      Observe failures for the missing processing, lease, and resource behaviors.
- [ ] Claim with the existing PostgreSQL lease pattern. Copy staging to a new attempt key before
      validation, stream a size-bounded SHA-256 check, and validate and process those exact bytes.
      Run ffprobe/FFmpeg on bounded local inputs, with protocol restrictions, scrubbed environment,
      no inherited service sockets, Linux syscall filtering to prevent network I/O, and resource
      limits. Admit only intended container formats and disable playlist and external-file inputs.
      Fail closed if isolation cannot be established. Reject media that fails decode or
      policy. Use JPEG thumbnails/posters, H.264/AAC MP4 video, and AAC/M4A voice playback, plus
      bounded normalized waveform samples. Keep arbitrary documents opaque and download-only.
      Publish metadata and the file/variant keys in one transaction only under a live lease.
      Keep a bounded variant budget and register attempt keys before writing them for later cleanup.
- [ ] Rerun real tests for the configured bounds and a successful image, video, and voice fixture.
      Verify Worker restart recovers expired work while text API and other jobs remain usable.
      Commit `feat(media): prepare immutable files in worker jobs`.

## Task 3: Atomic references, avatar assignment, and authorized reads

**Files:** Create `migrations/202611110003_media_references.sql` and
`src/media/{references,downloads}.rs`.
Modify `src/messages/{model,content,service,acceptance,projection,commands}.rs`,
`src/jobs/maintenance.rs`, `src/accounts/{model,profile,http}.rs`,
`src/contacts/{mod,directory}.rs`,
`src/conversations/{community_model,community_service,community_queries}.rs`,
`deploy/Caddyfile`, and generated contracts.
Extend `tests/{media,messages,message_lifecycle,conversations,account_http}.rs`.

**Interfaces:** `SendMessage.attachments: Vec<AttachmentInput>` defaults to empty and is omitted
when serializing an empty list. Each input has `occurrence_id` and `file_id`; array order is album
order. `CanonicalMessage.attachments: Vec<AttachmentView>` projects ordered validated metadata
without URLs. `lock_ready_files(&mut PgConnection, ReferenceRequest)` checks ownership, purpose,
and hold under ordered file locks. Authenticated download routes take reference and variant:
`GET /api/v1/media/messages/{message_id}/attachments/{occurrence_id}/{variant}`,
`GET /api/v1/media/avatars/{owner_kind}/{owner_id}/{variant}`, and
`GET /api/v1/media/uploads/{upload_id}/preview/{variant}`. Each returns `SignedDownload` with `url`
and `expires_at`. `owner_kind` is `user` or `conversation`.
Avatar assignment uses `SetAvatar { operation_id, expected_version, file_id }`, with nullable
`file_id` for removal, on `PUT /api/v1/account/profile/avatar` and the community command route.

- [ ] Add `accepted_album_replays_after_its_files_are_collected` and
      `download_checks_current_reference_visibility` in `tests/media.rs`. Cover lost acceptance,
      an unauthorized or unready item causing zero accepted rows, repeated file occurrences,
      caption edits, personal hide/clear, removal, deletion/expiry, and avatar variant isolation.
      Model the post-collection state with a fixture until Task 4 introduces the collector.
- [ ] Run `cargo test --locked --test media -- --include-ignored` with isolated PG/S3 and confirm
      the new send and signing tests fail before the reference paths exist.
- [ ] Hash ordered attachments as part of send identity while preserving old text-only hashes.
      Reconcile an already accepted identity before checking file readiness. Authorize send using
      current M5 policy and lock conversation, participant accounts, and file IDs in that order
      before feed heads. Insert references and consume pending holds with message acceptance.
      Permit empty captions only for media messages, keep versioned caption edits, and remove
      references on shared deletion/expiry. Personal hide/clear restricts reading without removing
      shared references. Give media-only rows a safe directory summary. Assign/remove user and
      conversation avatars through their existing version checks and metadata permissions.
      Project attachment metadata and avatar references through existing authorized paths.
      Reuse current message and metadata visibility at signing, return `no-store`, and configure
      safe disposition/type and `nosniff` on the cookie-free origin. Cap signed GET at one minute.
- [ ] Rerun the media and existing text/lifecycle tests, verify Range, CORS, and expiry against
      real SeaweedFS, and regenerate/check contracts.
      Commit `feat(media): publish authorized media references`.

## Task 4: Expiry, collection, and coordinated storage recovery

**Files:** Create `src/media/cleanup.rs` and extend `src/media/{uploads,jobs,references}.rs`,
`src/runtime.rs`, `tests/media_jobs.rs`, and `docs/operations.md`.

**Interfaces:** `MediaCleanup::run(CancellationToken)` claims bounded work. Reference writers and
collection use the same file-row lock. `deleting` forbids new references and is resumable after
partial object deletion. Release quota only after successful cleanup, counting missing objects
as already deleted. Use the reservation and attempt records to find orphaned staging and variants.

- [ ] Add `collector_preserves_a_live_reference_under_contention` and
      `cleanup_resumes_after_partial_delete_and_late_put`. Cover an eight-day ready hold, expired
      multipart, late signatures, missing objects, shared avatar/message retention, and stale jobs.
- [ ] Run `cargo test --locked --test media_jobs -- --include-ignored` with isolated PG/S3 and
      observe the collection failures before adding the Worker loop.
- [ ] Implement transactional claims and retryable physical cleanup. Reap staging after the last
      outstanding signature plus grace, abort unused multipart uploads, and collect only candidates
      outside live leases. Keep account and deployment accounting conservative through retries.
      Document a coordinated backup that quiesces mutations and preserves PostgreSQL, filer,
      master, and volume state. Include restoring and reading a known file through its reference.
- [ ] Rerun the race and restart tests, including quota recovery after confirmed deletion.
      Commit `feat(media): collect expired uploads and unused files`.

## Task 5: Durable browser transfer and pending send ownership

**Files:** Create `web/src/features/media/{uploadClient,uploadTransfer}.ts` and
`web/src/features/media/uploadTransfer.test.ts`. Modify `web/src/features/chat/data/`
`{pendingMessages,ChatOwner,messageModels}.ts` and their colocated tests.

**Interfaces:** `PendingAttachment` carries occurrence ID, source Blob, filename, kind, SHA-256,
and current upload/file ID. `ChatOwner.enqueueMedia(input: EnqueueMediaInput): Promise<void>`
commits ordered media and caption in one pending-store update. `resumeUpload` accepts
`ResumeUploadInput` and returns `Promise<UploadStatus>` in the ready state. The existing send
transport freezes and submits only ready ordered file IDs and occurrence IDs.

- [ ] Add tests named `resumes_using_server_parts_after_owner_restarts`,
      `late_tab_cannot_restore_cancelled_media`, and `media_pending_does_not_block_text_send`.
      Assert no transport on failed local persistence, stable IDs after reload, only missing parts
      requested, a retained caption, and a matching SHA-256 before reusing parts after reselection.
- [ ] Run `pnpm --dir web test src/features/media/uploadTransfer.test.ts src/features/chat/data`
      and observe failures for the missing durable media path.
- [ ] Persist Blobs with metadata under the existing account/session fence. Compute and save
      SHA-256 with Web Crypto before reserving, one file at a time. Acquire expiring IndexedDB
      claims transactionally across tabs and check the generation before committing progress.
      Reconcile status before starting. Use XHR and abort signals for progress and cancellation,
      and send only missing parts. Respect local byte/count limits and leave selections intact
      on persistence failure.
      Reconcile ambiguous frozen sends with the same payload and IDs. Replace expired uploads only
      before payload freeze, or offer an explicit fresh send after definitive failure. Release
      Blobs on acceptance, cancellation, deadline, and session loss. Keep independent text runnable.
- [ ] Rerun the targeted frontend tests and `pnpm --dir web build`.
      Commit `feat(media): resume pending uploads across browser restarts`.

## Task 6: Composer, playback, and avatar UI

**Files:** Modify `web/src/features/chat/connected/ConnectedChat.tsx`,
`web/src/features/chat/composer/{MessageComposer.tsx,attachments/useComposerAttachments.ts}`,
`web/src/features/chat/messages/{MessageBubble.tsx,messageDownloads.ts}`, existing media content
components, `web/src/features/media/MediaViewer.tsx`, `web/src/components/Avatar.tsx`, and
`web/src/features/settings/profile/SettingsProfile.tsx`. Create
`web/src/features/media/{useVoiceRecorder,useAuthorizedMediaUrl}.ts` and colocated behavior tests.

**Interfaces:** `useVoiceRecorder()` exposes recording state and a finished `Blob` to the composer.
`useAuthorizedMediaUrl(request: MediaReferenceRequest)` resolves a reference and variant for the
current session and visibility generation. Neither signed URLs nor local object URLs are durable.

- [ ] Add `renders_one_bubble_through_album_retry_and_acceptance`,
      `ignores_late_url_after_conversation_access_is_removed`, and
      `releases_microphone_after_cancel`. Cover missing recorder support, URL renewal during video
      playback, saved playback position, and a caption-only edit retaining media identity.
- [ ] Run `pnpm --dir web test src/features/media src/features/chat src/features/settings/profile`
      and observe failures for the missing connected paths.
- [ ] Wire selection, drop, paste, order, captions, retry/cancel, and progress to Task 5. Use
      local object URLs for pending previews and revoke them on disposal. Reuse existing timeline
      IDs, media geometry, viewer navigation, and visibility scheduling. Resolve signed URLs lazily,
      fence stale responses, and preserve playback position when authorization permits renewal.
      Select MediaRecorder format by runtime support and always release microphone tracks. Use
      the same uploader for avatar updates. Apply existing profile and community permissions at
      assignment, preserving the current avatar until the ready replacement commits.
- [ ] Rerun focused tests, `pnpm --dir web format:check`, and `pnpm --dir web build`.
      Commit `feat(media): connect composer recording and private playback`.

## Task 7: Compose acceptance and milestone handoff

**Files:** Create `web/e2e-accounts/media-messaging.spec.ts`, `web/playwright.media.config.ts`, and
`docs/media.md`. Modify `web/package.json`, `scripts/check-runtime.mjs`, `docs/development.md`,
`web/docs/development.md`, `README.md`, and the [roadmap](2026-11-08-product-milestones.md).

- [ ] Add `resumes_after_last_tab_closes_without_duplicate_send` to the connected media suite.
      Start with a persistent browser profile, pause after one real S3 part commits, drop its
      response, close the final tab and browser, then reopen the same profile and chat. Count PUTs
      and require zero repeats of confirmed parts. Drop the acceptance response after commit and
      require one canonical recipient message, stable occurrence order, and the same sender bubble.
      Add a real voice record/playback and avatar round trip, plus playback and signing after access
      removal. Confirm live references survive an isolated restore of PostgreSQL and SeaweedFS.
- [ ] Enable media in the isolated Compose project and wire `pnpm --dir web test:media` into
      `node scripts/check-runtime.mjs`. Run full isolated
      Compose acceptance including existing browser suites, the real SQLx media suites, and Worker
      recovery. Record real mobile recording/playback in `web/docs/development.md`.
      Keep physical mobile results separate from Playwright emulation and report any gap.
- [ ] Run `cargo fmt --all --check`, `cargo clippy --locked --all-targets -- -D warnings`,
      `cargo test --locked --all-targets`, `pnpm --dir web test`, `pnpm --dir web format:check`,
      `pnpm --dir web api:check`, `pnpm --dir web build`, and `pnpm --dir web test:browser`.
- [ ] Document the supported media flow and repeatable checks. Review the whole milestone diff
      against the approved spec, resolve material findings, and rerun affected checks. Mark the
      roadmap complete only after the exit gate passes. Commit acceptance and docs separately.

## Technical references

- [AWS SDK for Rust presigning](https://docs.rs/aws-sdk-s3/latest/aws_sdk_s3/presigning/index.html)
- [S3 multipart limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html)
- [S3 multipart completion][s3-completion]
- [Rust libseccomp bindings](https://docs.rs/libseccomp/latest/libseccomp/)

[s3-completion]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html
