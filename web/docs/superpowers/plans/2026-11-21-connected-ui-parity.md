# Connected UI Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all findings in the accepted connected-frontend review and align presentation with tweb.

**Architecture:** Reuse shared React presentation and keep connected data owners authoritative.
Adapt narrow component interfaces where needed, without mounting demo stores in connected mode.
Implement serially because several tasks share the connected chat and account entry points.

**Tech Stack:** React, TypeScript, CSS modules, Ark UI, Motion, Zustand, pnpm, Vitest, Playwright.

**Spec:** `web/docs/superpowers/specs/2026-11-21-connected-ui-parity-design.md`

## Global Constraints

- Work in the current checkout on `main`; do not create a branch or worktree and do not push.
- Keep design and implementation-plan documents uncommitted unless explicitly requested otherwise.
- Use the existing Prettier configuration and pnpm; do not replace the project's tools.
- All authored code, comments, documents, logs, and commit messages are English.
- Follow the user's readability rules, including a 100-character line limit except long strings/URLs,
  at most three nesting levels and three chained calls, descriptive names, and one statement per line.
- Explain ordering, asynchronous ownership, cancellation, and permission decisions beside the code.
- Add behavior regression tests for bugs and important interaction boundaries; no source-shape tests.
- Use Conventional Commits and one independently reviewable responsibility per commit.
- Preserve server business rules, session isolation, durable outbox identities, and access fencing.
- Reference source: `/Users/by291/code/js/tweb`, revision `3868c9c`.

## Review Focus

- Switching destination or typing while restoration is awaiting storage never changes the new draft.
- A neighboring gallery failure does not block the selected media or cancel its independent retry.
- Sidebar navigation preserves mounted chat input, reading anchors, and returns keyboard focus.
- Preview and accepted media retain geometry even for portrait, panoramic, and three-item albums.
- Motion interrupted by closing, resizing, access removal, or reduced-motion changes cleans up.

---

### Task 1: Fence recovery and repair remote search navigation

**Files:** Modify `web/src/features/chat/data/ChatOwner.ts`, `search/GlobalMessageSearch.tsx`,
`history/MessageTimeline.tsx`, `connected/ConnectedChat.tsx`, and their owning tests under
`web/src/features/chat/`.

**Interfaces:** Add optional `onJumpToDate(timestamp: number): void` to the timeline; connected mode
calls `owner.jumpToDate`, while local mode retains its in-memory fallback. Keep storage persistence
separate from the decision to publish a restored draft into the active editor.

- [x] Add regressions for changing chat, later typing, and session/access changes during restoration;
      use the previous review's `/private/tmp/tg-chat-interaction-review` reproductions as evidence only.
- [x] Add search coverage for one expired hit and a still-valid sibling in the same conversation.
- [x] Add date selection coverage proving a date outside the loaded window uses the remote anchor.
- [x] Run focused tests and observe the expected failures, then implement the ownership/navigation fix.
- [x] Run focused tests, the frontend unit suite, Prettier, and TypeScript; inspect the diff.
- [x] Commit recovery and search/date changes in separate conventional responsibility groups.

### Task 2: Preserve account edits and restore contact safety

**Files:** Modify `accounts/ProfilePanel.tsx`, `AccountForm.tsx` where needed, `ContactsPanel.tsx`,
`Accounts.module.css`, and owning tests. Paths are under `web/src/features/`.

**Interfaces:** Keep `ProfilePanel` props and server optimistic-version checks. Retain dirty form
fields across profile revisions; contact avatars use the existing `RemoteAvatar`. Relationship
actions use named confirmation and report the specific completed operation.

- [x] Reproduce dirty text surviving avatar assignment/removal and a remote profile revision.
      Submitting must preserve clean remote fields and detect conflicting edits to the same field.
- [x] Add contact behavior checks for canceling and confirming a named block/removal.
- [x] Implement version reconciliation, authorized avatars, and contact context-menu confirmations.
- [x] Run focused red/green checks, full unit suite, formatting, and TypeScript.
- [x] Commit profile preservation and contact presentation/actions separately.

### Task 3: Share connected layout, appearance, settings, and navigation

**Files:** Modify `App.tsx`, `accounts/AccountWorkspace.tsx`, `AccountSettingsHome.tsx`,
`chat/connected/ConnectedChat.tsx`, its CSS and directory/pin chrome, `layouts/chat/ChatLayout.*`,
`layouts/sidebar/SidebarNavigation.*`, and local settings adapters/tests as needed under `web/src/`.

**Interfaces:** Share presentation with `ChatLayout`, `ChatHeader`, `PinnedMessageBar`, selection
toolbar, `useAppearanceTheme`, `ChatWallpaper`, and existing settings pages. Extend presentation
props narrowly rather than importing demo state. Add a connected navigation adapter for account
pages and local settings; browser Back/Escape move one layer and restore focus. Sidebars default
to 360px and allow persisted 320–480px resizing; content cap 696px and header 48px remain shared.

- [x] Test General/Keyboard reachability, system-theme changes, local preference application, and
      returning from nested settings without losing composer text or the active conversation.
- [x] Test Back/Escape, focus restoration, and the handheld directory/chat/panel boundary.
- [x] Separate connected palette application from demo legacy migration; fresh connected system
      appearance must follow changes without opening demo persistence.
- [x] Test absent appearance storage with dark startup and a subsequent system change. Connected
      mode defaults to System only without a saved preference; explicit Classic and demo migration
      retain their semantics.
- [x] Implement shared floating layout, header/pin/selection chrome, complete appearance ownership,
      local settings routes, settings navigation transitions, and column resizing.
- [x] Run focused and full unit checks, TypeScript/build, formatting, and browser layout/navigation
      checks at 1440px, 1024px, and 390px, including reduced motion and dark/system appearance.
- [x] Commit layout, appearance/settings, and navigation in coherent responsibility groups.

### Task 4: Use responsive nonmodal information panels

**Files:** Modify `communities/CommunityProfile.tsx`, its CSS, `chat/connected/ConnectedPeerProfile.tsx`,
`PollVotersDialog.tsx`, its CSS, `ConnectedChat.tsx`, and panel-focused tests under `web/src/features/`.

**Interfaces:** Information content renders into the shared right-panel slot from Task 3, with
selection state owned by the connected workspace. Desktop background chat remains operable;
handheld panels fill available width. Voter rows can navigate to a user. Existing session and
membership invalidation continue to clear unauthorized information.

- [x] Add behavior checks for background chat interaction, close/focus return, access removal,
      and selecting a voter; verify no fabricated timestamp is shown.
- [x] Replace modal backdrops with shared sliding sidebars and preserve mounted content through exit.
- [x] Run focused/full tests, format/type checks, and browser open/close/interruption checks.
- [x] Commit profile panels and voter-result navigation as independent changes.

### Task 5: Reuse media presentation and isolate gallery loading

**Files:** Modify `chat/messages/content/media/ConnectedMessageMedia.tsx`, `PendingMessageMedia.tsx`,
their CSS, `chat/messages/MessageBubble.tsx`, existing media frame/document adapters and geometry,
viewer transition integration, and owning tests under `web/src/features/`.

**Interfaces:** Authorized URLs feed the existing photo/video/album/document/voice primitives;
occurrence IDs retain the stable viewer identity. The selected item opens before neighbors resolve,
and each neighbor has independent loading/error/retry state. Pending metadata carries local geometry
into the accepted presentation. Do not weaken URL renewal or access revocation.

The gallery/controller lives above virtual message rows. Extend `MediaSelection`, persisted pending
uploads, `pendingUploadDisplay`, and `PendingMediaDisplayItem` with compatible optional dimensions;
Task 6 produces the same contract. Older records and missing blobs retain occurrence identities.

- [x] Add regressions for a valid selected item with one failed neighbor, canceled stale gallery
      loads, source-to-viewer transitions, and pending-to-accepted portrait/album geometry.
- [x] Test source-row eviction/recycling with an open viewer, real access/session loss, and reload
      between enqueue/acceptance with both legacy and dimension-bearing pending records.
- [x] Adapt authenticated media into shared bounded media frames, actual-dimension album layout,
      document cards and overlay/inline metadata. Preserve original download authorization.
- [x] Register thumbnail source geometry for viewer opening/closing and retain cancellation/retry
      progress inside the same final media structure.
- [x] Run focused/full tests, formatting, TypeScript/build, and browser media geometry/motion checks.
- [x] Commit gallery isolation, media presentation, pending geometry, and viewer integration by duty.

### Task 6: Align attachment confirmation and composer helpers

**Files:** Modify `chat/composer/attachments/ConnectedAttachmentDialog.tsx`, `ConnectedAttachments.tsx`,
their CSS, `MessageComposer.tsx`, link preview context/hooks, and owning tests under `web/src/features/`.

**Interfaces:** Retain `MediaSelection` and durable enqueue submission shape. Attachment caption
gets desktop initial focus; touch leaves keyboard closed. Shared media geometry drives the 420px
preview, 56px file rows and 48px icons. A single helper slot prioritizes a valid link preview and
restores reply/edit context after dismissal; loading/unavailable metadata never leaves an empty bar.
Populate the optional local dimensions contract from Task 5 before enqueueing.

- [x] Add regressions for desktop typing/Enter, touch initial focus, multi-image actual-size preview,
      unavailable metadata, and restoring a reply after preview dismissal.
- [x] Implement the reference popup/control layout and single composer helper slot.
- [x] Run focused/full tests, formatting/type checks, and browser focus/responsive layout checks.
- [x] Commit attachment confirmation and helper arbitration separately.

### Task 7: Complete recording preview and shared voice speed

**Files:** Modify `media/VoiceRecordingBar.tsx`, `voiceRecordingMeter.ts`, `useVoiceRecorder.ts`, their
CSS, `chat/messages/content/media/VoiceMessage.tsx`, playback preference owner, and owning tests.

**Interfaces:** Recorder retains complete peaks separately from live metering. Preview presents
playback time/progress and seek with keyboard/pointer support. Voice playback rate is shared across
messages and virtual remounts, with 0.5/1/1.5/2 options, using the existing playback owner where viable.

- [x] Add regression checks for full long-recording waveform, seeking, preview time, rate inheritance,
      cancellation, and media ownership cleanup.
- [x] Implement the reference pill/control geometry, 150ms appearance motion, preview playback state,
      and shared rate control without changing capture/admission rules.
- [x] Run focused/full tests, formatting/type checks, and fake-microphone browser checks.
- [x] Commit recording preview and shared playback preferences independently.

### Task 8: Align one-to-one call presentation

**Files:** Modify `calls/CallPanel.tsx`, its CSS, narrow call presentation components as needed,
media preview metadata, connected topbar integration, and owning tests under `web/src/features/`.

**Interfaces:** Keep `CallOwner` execution, actions, media nodes, tab ownership and server timer.
Provide a 400×580px desktop initial panel and responsive handset layout, centered identity, state
gradient, circular controls, device settings and fullscreen. Compact call chrome always exposes
mute/hangup/restore; video nodes stay mounted through collapse. Respect local front/rear mirroring.

- [x] Add regressions for controls in compact mode, no track remount on collapse, state/permission
      changes during motion, fullscreen exit, and local preview direction.
- [x] Implement reference call topology, controls, state transitions, and compact topbar.
- [x] Run focused/full tests, formatting/type/build checks, and browser ringing/active/reconnecting
      panels at desktop/handheld widths and reduced motion.
- [x] Commit call presentation and compact controls in coherent groups.

### Task 9: Restore message interaction parity

**Files:** Modify `chat/connected/ConnectedChat.tsx`, message action/selection adapters,
`content/contact/ContactMessage.tsx`, poll context menu/footer, `history/useReplySwipe.ts`, timeline
CSS, search-highlight context, and owning tests under `web/src/features/chat/`.

**Interfaces:** Restore selected-text copy and contact Add without demo identity/state. Poll
management actions use the existing context-menu contract and authoritative permissions. Search
highlight context is separate from timeline filtering. Reply gestures support ordinary media and
horizontal trackpad events while controls retain native gestures; 48px threshold, 64px cap,
250ms return, circular indicator, and grouped avatar movement match the reference.
Connected Add awaits the real contacts API, excludes the authenticated self, and preserves card
content on rejected/private/ineligible responses; do not mount demo ContactActions.

- [x] Add behavior tests for connected copy, Add contact, poll management permissions, keyword
      highlighting after a remote jump, media swipe, trackpad gesture and native-control exclusion.
- [x] Implement the missing adapters, poll menu layout, highlight context and gesture feedback.
- [x] Run focused/full checks, format/type/build checks, and controlled-clock browser gesture checks.
- [x] Commit message affordances, poll actions, search highlighting and swipe changes by duty.

### Task 10: Align account and community presentation and verify the complete result

**Files:** Modify account/auth scaffold, settings profile/search adapter, community creation forms,
related CSS/tests/browser suites, and owning topic documentation under `web/` as needed. The recorded
follow-ups also touch media transition visibility, recording time formatting, call fullscreen
ownership, composer accessibility, and their owning regression fixtures.

**Interfaces:** Connected settings reuse `SettingsProfile` cover/search with the real account.
Username/password auth retains existing semantics in the reference 392px scaffold with 16px padding,
32px radius, floating labels and 24px input gaps. Community creation selects a local avatar, then
creates the community and publishes the avatar through the authorized API; pending creation must
not duplicate when avatar upload needs retry. Use corner Next and retain public/approval options.

- [x] Test connected settings search and profile expansion, narrow auth input visibility, and
      group/channel creation with avatar failure/retry without duplicate communities.
- [x] Extend the subscribed profile success regression to assert server-normalized text after save
      (Task 2 minor review observation); use the existing successful behavior case.
- [x] Canonicalize direct General Settings destinations so Wallpaper and Power Saving work from
      `?account=general`, covering Task 3's minor route observation.
- [x] Correct the existing composer image-drop fixture so Lexical executes its real drop path
      without a missing DragEvent exception (Task 4 review observation).
- [x] Resolve deferred media source clipping against the history scrollport and the overlong
      geometry-fixture comment from Task 5 review.
- [x] Expose unavailable link-preview state accessibly, and retain the first-admission/subpixel
      geometry assertion in the connected browser suite (Task 6 minor review observations).
- [x] Correct exact centisecond recording timer/slider text after decimal seeks, covering
      Task 7 floating-point formatting observation.
- [x] Align the formatter-ignored recording fixture call indentation noted in Task 7 re-review.
- [x] Check call collapse against the current fullscreen element rather than the last React
      fullscreen event snapshot (Task 8 minor observation), unless the transition fix resolves it.
- [x] Fence pending fullscreen-exit completion across same-call rediscovery so an old callback
      cannot collapse the newly active call panel (Task 8 scoped-review observation).
- [x] Extend the existing session relationship regression with delayed same-peer writes,
      including rejection followed by a successful queued write (Task 9 minor observation).
- [x] Implement the remaining account/community presentation against actual tweb owning sources.
- [x] Run the complete frontend unit suite, format check, build, browser suite, and available
      connected runtime acceptance. Update lasting topic documentation and report environment limits.
- [x] Verify every spec requirement is mapped to implemented code and evidence before completion.
- [x] Commit account scaffold, community creation, and lasting documentation by responsibility.

## Final integration corrections

- [x] C1: fence ordinary draft-conflict publication without losing the original alternative.
- [x] I1: retain later account routes and queries through delayed message/contact/community actions.
- [x] I2: gate chat visibility and focus under full-cover call presentations.
- [x] I3: eliminate the connected startup graph from standalone demo builds.
- [x] I4: give handheld information and voter layers one-layer browser Back ownership.
- [x] I5: recheck an open poll editor at deadline and submission.
- [x] I6: reconcile authoritative relationships across independent session tabs and account return.
- [x] I7: apply field-per-line literals and the required fixture nesting bound.
- [x] M1: align the first-paint sidebar with validated persisted/default geometry.
- [x] M2: apply the native creation-checkbox theme accent.
- [x] M3: retain first-page voter recovery through a successful later-page history restoration.
- [x] Run the scoped integration re-review and final current-tree verification.
