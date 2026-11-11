# M7 Message Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect polls, checklists, forwarding, bundled assets, contact cards, history search,
and text link previews to authoritative server state.

**Architecture:** Extend existing message acceptance, commands, and reader-specific projections.
PostgreSQL owns interaction state and commits changes with the personal sync feed. Search uses
the history permission predicate, and the Worker delegates preview fetching to an isolated process.

**Tech Stack:** Axum, SQLx, PostgreSQL with `pg_trgm`, RustFS S3, React, IndexedDB, and Playwright.
Reuse the current HTTP client and HTML parser for preview metadata.

**Spec:** [Approved M7 design](../specs/2026-11-11-m7-message-interactions-design.md) and
[milestone acceptance][roadmap].

## Global constraints

- Work in the current checkout. Each task ends in its own Conventional Commit. Add migrations
  after M6 and preserve existing migrations, text-only hashes, and optional field defaults.
- Reuse current permissions, history visibility, operation identity, and sync observation fences.
  Keep decimal versions as strings on the wire. Project authorized state on receipt replay.
- Persist mutations and sync changes in one transaction. Preserve lock order across conversation,
  account, message or interaction, file, and feed updates. Keep external I/O outside transactions.
- Keep demo dispatch separate. Preserve current drafts and M6 upload, playback, and GC semantics.
- Follow [AGENTS.md](../../../AGENTS.md). Use logical blank lines to separate preparation,
  validation, and mutation. Give each public function a one-line English purpose comment.
  Place an English reason immediately before complex branches and beside ordering, concurrency,
  idempotency, recovery, and upstream constraints where correctness depends on them.
- Run Rustfmt and the existing frontend Prettier checks for touched files. Keep added code within
  100 characters per line and apply the repository limits on nesting, call chains, and parameters.
  Keep comments, code identifiers, and commit messages in English.

## File ownership and order

| Task              | Owning boundary                                                       | Dependencies |
| ----------------- | --------------------------------------------------------------------- | ------------ |
| 1. Message bodies | Acceptance, projection, bundled catalogue, and contact sharing        | M3–M6        |
| 2. Polls          | Poll commands, deadlines, reader privacy, and vote UI                 | 1            |
| 3. Checklists     | Task and list versions, participant permissions, and checklist UI     | 1            |
| 4. Forwarding     | Conversation policy, per-destination acceptance, and file references  | 1–3          |
| 5. Search         | Permission-filtered queries, history anchors, and connected search UI | 1            |
| 6. Link previews  | Preview jobs, isolated fetches, and text cards                        | 1            |
| 7. Acceptance     | Connected browser flows, Compose, and operator guidance               | 1–6          |

Each feature owns its SQL and domain logic next to the relevant message code. Add only its
entry points to shared dispatch and projections. Generate `openapi/api.json` and
`web/src/api/schema.d.ts` with `pnpm --dir web api:generate` in the task that changes the contract.

## Review focus

- A pre-close poll response arrives after closure or membership revocation (Tasks 2 and 7).
- A checklist completion races removal of the task or withdrawal of permission (Task 3).
- A committed forward loses its response, then the source is protected or deleted (Task 4).
- A short CJK query hits its work budget among hidden or cleared rows (Task 5).
- A preview job completes after the link changed or the message expired (Task 6).

## Task 1: Typed message bodies, bundled stickers, and contact cards

**Files:** Create `src/messages/bodies.rs` and `migrations/202611120001_message_bodies.sql`.
Modify `src/messages/{model,service,acceptance,projection}.rs`, `src/jobs/maintenance.rs`,
`deploy/Dockerfile`, `web/src/features/chat/data/{ChatOwner,messageModels}.ts`,
`web/src/features/chat/connected/ConnectedChat.tsx`, and the existing composer and contact renderer.
Extend `tests/messages.rs` and `web/src/features/chat/data/messageModels.test.ts`.

**Interfaces:** `SendMessage.body: Option<MessageBodyInput>` and
`CanonicalMessage.body: Option<MessageBodyView>` are omitted when absent. Start with the
tagged `sticker` (`sticker_id`) and `contact` (`display_name`, optional `account_id` and `phone`)
variants. Poll and checklist tasks extend these enums. Derive the preview of each kind from
canonical data. The input has no asset path, account profile payload, or aggregate state.

- [ ] Add `legacy_text_replay_keeps_its_identity_with_typed_bodies`,
      `sticker_and_contact_bodies_round_trip_through_history_and_sync`, and rejection cases for
      an unknown sticker and inaccessible account. Assert the card never imports private fields.
- [ ] Run `cargo test --locked --test messages -- --include-ignored` against isolated PostgreSQL.
      Confirm the new typed-body behavior is missing before implementing it.
- [ ] Add nullable typed-body storage and validate against the bundled sticker manifest and current
      account directory. Include a present body in the canonical send fingerprint. Keep old hash
      serialization when absent. Bind visible account links at send time and authorize link opening
      with the usual directory rules. Clear typed content on deletion and expiry. Preserve unrelated
      drafts when sending stickers.
- [ ] Render the body through the existing composer and card components, persist sends through
      `ChatOwner`, regenerate API types, and rerun the PostgreSQL tests and
      `pnpm --dir web test src/features/chat/data/messageModels.test.ts`.
- [ ] Commit `feat(messaging): connect bundled stickers and contact cards`.

## Task 2: Polls, quizzes, and private result projections

**Files:** Create `src/messages/polls.rs`, `tests/message_interactions.rs`, and
`migrations/202611120002_polls.sql`. Extend message bodies, command and HTTP dispatch,
`src/jobs/maintenance.rs`, the connected composer, `ChatOwner`, and the existing poll renderer.

**Interfaces:** Add `PollInput` and `PollView` as the `poll` body variants. `PollInput` holds stable
option IDs, question, rules, deadline, and quiz answer and explanation. `PollView` exposes
the reader's selection and only authorized results. Add `vote_poll`, `edit_poll`,
`add_poll_option`, and `close_poll` to `CommandAction`. Vote carries `message_id` and
`option_ids`, and edits carry the expected poll version. Add a bounded public-voter read at
`GET /api/v1/messages/{message_id}/poll/voters` with an option filter and cursor.

- [ ] Add `concurrent_votes_replace_one_account_selection`, `quiz_answers_follow_reader_visibility`,
      and `late_votes_fail_when_the_database_deadline_passes`. Assert concurrent selections count an
      account once, anonymous and channel responses reveal no voter names, and every response path
      omits hidden totals. Hold a vote behind the poll lock across the deadline. Check edits, option
      addition, and close authority before and after a vote.
- [ ] Run `cargo test --locked --test message_interactions -- --include-ignored` against isolated
      PostgreSQL. Confirm the poll assertions fail for missing behavior.
- [ ] Store poll, stable options, and per-account selections separately. Match the composer cap
      of 2–12 options and 100 UTF-16 code units per option. Use one account selection replacement
      under the poll lock, one quiz submission, and versioned edits. Check the deadline with the
      database clock after taking the lock. Reuse maintenance to publish due closure. Apply the
      design's result and participant rules to
      send, commands, history, and sync. Channel polls accept anonymous voting only.
- [ ] Connect the existing composer and poll card to canonical commands. Keep the current
      account's unsent choices local. Fence late results with the cache's interaction version and
      visibility generation. Regenerate types and rerun PostgreSQL and focused poll/cache tests.
- [ ] Commit `feat(polls): support authoritative votes and quizzes`.

## Task 3: Collaborative checklists

**Files:** Create `src/messages/checklists.rs` and `migrations/202611120003_checklists.sql`.
Extend bodies, commands, projections, `tests/message_interactions.rs`, the connected composer,
`ChatOwner`, and the existing checklist card.

**Interfaces:** Add `ChecklistInput` and `ChecklistView` as the `checklist` body variants. Views
expose list and task versions plus authorized completion attribution. Add `set_checklist_task`
(`message_id`, `task_id`, `expected_task_version`, `is_complete`), `append_checklist_tasks`, and
`edit_checklist` to `CommandAction`. The latter two carry `expected_list_version`.

- [ ] Add `different_checklist_tasks_can_complete_from_the_same_list_version`,
      `task_completion_conflicts_with_a_concurrent_removal`, and
      `channel_subscribers_cannot_read_other_completers`. Also verify permission revocation and a
      duplicate completion replay leave a single accepted state.
- [ ] Run the Task 2 PostgreSQL test command and confirm the checklist tests fail as expected.
- [ ] Store stable task IDs and enforce the composer limits of ten tasks and 255 UTF-16 code
      units per label. Keep list and task versions independent. Use the existing conflict projection
      for stale edits and validate participant permissions at commit. Emit completion and structural
      changes through the same feed. Apply the channel attribution rule on every read path.
- [ ] Connect the existing form and task actions, including the conflict response. Regenerate
      types and rerun the PostgreSQL suite and focused checklist/cache tests.
- [ ] Commit `feat(checklists): synchronize versioned tasks`.

## Task 4: Forwarding policy, destination batches, and media references

**Files:** Create `src/messages/forwarding.rs`, `tests/forwarding.rs`, and
`migrations/202611120004_forwarding.sql`. Extend conversation settings, message acceptance and
commands, `src/media/references.rs`, and the connected recipient picker, selection controls,
and pending operation store.

**Interfaces:** `POST /api/v1/messages/forward` accepts `ForwardBatch` with a destination,
`operation_id`, and ordered source and new message IDs. Return a `ForwardReceipt` with ordered
message identities and the current authorized destination projection. Add `set_forwarding_policy`,
`batch_hide`, and `batch_delete` commands. The client persists one frozen request per destination.

- [ ] Add `forward_retry_after_source_deletion_returns_the_same_batch`,
      `protected_source_rejects_the_entire_destination_batch`, and
      `forwarded_file_survives_source_deletion_and_collection`. Cover direct consent reset,
      policy races, different destination outcomes, draft preservation, and snapshot sanitization.
- [ ] Run `cargo test --locked --test forwarding -- --include-ignored` with isolated PostgreSQL
      and RustFS. Confirm the missing batch and reference behavior fails.
- [ ] Cap batches at 20 unique source messages per destination and scope hide/delete to one
      conversation. Lock touched conversations and files in stable ID order. Check existing batch
      identity before revalidating a new forward. Bind the destination batch fingerprint durably,
      retain its ordered message IDs across receipt pruning, and give each accepted item its own
      message operation identity. Reject operation ID collisions across command kinds and changed
      payloads. Roll back all rows on a new batch failure and apply current visibility to replay.
- [ ] Copy only server-authorized bodies and derive new occurrence IDs for the immutable source
      files. Add a reference-copy entry point that accepts an authorized source and destination,
      rather than relaxing the sender-owned upload path. Keep immutable source labels and sanitized
      read-only poll/checklist copies. Make policy changes and direct consent follow the conversation
      lock so a forward observes one policy decision.
- [ ] Connect the destination picker and bounded selection actions. Retry persisted destinations
      independently and preserve drafts. Regenerate types and rerun forwarding, command, and real
      media tests, plus focused picker and pending-store tests.
- [ ] Commit `feat(forwarding): send authorized destination batches`.

## Task 5: Search, date anchors, and media history

**Files:** Create `src/messages/search.rs`, `tests/search.rs`, and
`migrations/202611120005_message_search.sql`. Extend `src/messages/{history,http}.rs`, `ChatOwner`,
`ChatSearch`, and the sidebar search UI.

**Interfaces:** `GET /api/v1/chat/search` takes `SearchQuery` with optional `conversation_id`,
`sender_id`, UTC date bounds, `kind`, and cursor plus the literal `query` string. `SearchPage`
returns hits, applied dates, observation cursor, next cursor, and a truncation flag. Add date and
kind filters to `HistoryQuery` while preserving its existing sequence, target, and pin modes.

- [ ] Add `chinese_and_english_queries_match_literal_substrings`,
      `short_queries_are_bounded_without_leaking_hidden_rows`, and
      `revoked_search_hits_cannot_be_opened`. Include `%`, `_`, and backslash literals, tied timestamps,
      filtered media and pin boundaries, and date jumps with missing or expired rows.
- [ ] Run `cargo test --locked --test search -- --include-ignored` against isolated PostgreSQL.
      Confirm the new query and cursor behavior fails before implementation.
- [ ] Index permitted normalized text and captions with PostgreSQL trigram indexes. Use stable
      `(created_at, id)` descending search order and bind the cursor to scope and filters. Reuse
      `projection::restrict_visible` for hits and anchors. Use the existing history sequence order
      for neighborhoods. Resolve a date to the first visible message at or after it, with the last
      visible message before it as fallback. Accept photo/video, file, voice, link, and other typed
      filters through a typed enum. Empty text with a media, file, or link filter browses one chat.
- [ ] Start with pages of 30, a 30-day window for queries of one or two Unicode scalar values,
      and a cap of 5,000 candidate rows inspected per short query before substring matching. Bound
      the candidate scan by conversation, dates, and the clear cursor. Apply the full visibility
      predicate before returning results, without reporting counts of suppressed rows. Cap wider
      short-query date ranges at 30 days and return the effective range. Mark a budget-limited result
      as truncated. Require at least three Unicode scalar values for global text search. Validate
      these defaults on Chinese and English history and inspect query plans before fixing them.
- [ ] Wire existing search, date, and media views to authorized pages. Cancel stale queries and
      reject responses from old visibility generations. Use `ChatOwner.jumpToMessage` for distant hits.
      Regenerate types and rerun search, history, and focused browser navigation checks.
- [ ] Commit `feat(search): query authorized message history`.

## Task 6: Asynchronous text link previews

**Files:** Create `src/jobs/link_previews.rs`, `src/bin/link-preview-fetcher.rs`,
`tests/link_previews.rs`, and `migrations/202611120006_link_previews.sql`. Extend acceptance,
edits, expiry, projections, `src/runtime.rs`,
`deploy/Dockerfile`, `compose.yaml`, the connected composer, and `LinkPreview.tsx`.

**Interfaces:** Add optional `disable_link_preview` to send and edit inputs and `link_preview`
to `CanonicalMessage`. `LinkPreviewView` contains `site_name`, `title`, and `summary`. Bind
`PreviewJob` to message ID, content version, URL, and lease. Worker asks the isolated fetcher for
metadata from that one URL and publishes only while the binding still matches.

- [ ] Add `stale_preview_jobs_cannot_restore_edited_or_expired_cards`,
      `preview_fetch_rejects_nonpublic_destinations_and_redirects`, and
      `preview_failure_leaves_the_message_and_link_usable`. Use controlled DNS and HTTP fixtures
      for redirect and DNS changes. Verify no outbound image request, a bounded body, and no card
      for a disabled preview.
- [ ] Run `cargo test --locked --test link_previews -- --include-ignored` with the isolated fixtures.
      Confirm the preview and fencing behavior fails before implementation.
- [ ] Select the first eligible HTTP(S) link from accepted content and enqueue without network
      I/O in the send or edit transaction. Use version and lease checks before publishing a card.
      Bump the interaction revision and append its feed event in the same transaction. Revoke
      obsolete jobs and cards through delete and expiry. Preserve legacy hashes when the option is
      absent.
- [ ] Run a dedicated unprivileged fetcher with no database, S3, or session credentials. Give
      Worker a private control path and enforce public-only egress for the fetcher. Validate and bind
      each resolved address before connecting, including redirects. Keep hostname verification for
      TLS. Disable ambient proxies, cookies, and automatic redirects. Start with a five-second total
      deadline, three redirects, 512 KiB of HTML, and two concurrent fetches per deployment. Parse
      only bounded text metadata. If the isolation boundary is unavailable, leave the link usable.
- [ ] Connect the sender opt-out and one metadata card. Regenerate types and rerun job, HTTP
      isolation, and focused rendering tests. Verify the deployed topology with isolated fixtures.
- [ ] Commit `feat(previews): generate isolated text link previews`.

## Task 7: Connected acceptance and handoff

**Files:** Create `web/e2e-accounts/message-interactions.spec.ts` and
`web/playwright.interactions.config.ts`. Modify `web/package.json`, `scripts/check-runtime.mjs`,
`docs/messaging.md`, `docs/development.md`, and the [roadmap].

- [ ] Add connected Chromium cases for two-session voting and checklist convergence, private
      projections after revocation, a lost destination receipt, a forwarded attachment after source
      deletion, and a distant Chinese search hit. Include an opt-out or stale-preview transition.
      Extend the existing demo and viewer tests where they already own interaction or scroll behavior.
- [ ] Add `pnpm --dir web test:interactions` to the isolated Compose runner. Exercise real
      PostgreSQL and RustFS with the new browser suite and the M6 close/reopen multipart test.
      Confirm the original message identity, only missing parts resent, and one recipient message.
- [ ] Run `cargo fmt --all --check`, `cargo clippy --locked --all-targets -- -D warnings`,
      `cargo test --locked --all-targets`, `pnpm --dir web test`, `pnpm --dir web format:check`,
      `pnpm --dir web api:check`, `pnpm --dir web build`, `pnpm --dir web test:browser`, and
      `node scripts/check-runtime.mjs`. All commands must exit successfully.
- [ ] Review the milestone diff against the spec and AGENTS.md, fix findings, and rerun affected
      checks. Update the owning documentation and roadmap after the exit gate passes.
- [ ] Commit `test(messaging): verify connected M7 workflows` and commit the handoff docs as
      `docs(messaging): describe connected message interactions`.

[roadmap]: 2026-11-08-product-milestones.md#m7-complete-message-interactions-and-history-discovery
