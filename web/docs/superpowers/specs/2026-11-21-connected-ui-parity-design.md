# Connected UI Parity

## Intent and authorization

The user requested a complete review of frontend additions made during backend delivery, compared
with `/Users/by291/code/js/tweb` at `3868c9c`. After receiving the findings, the user explicitly
requested that all findings be fixed and that changes be committed in responsibility-based groups.
The review and that instruction define this work; no new product scope is proposed here.

## Approach

Reuse the existing React presentation components, geometry, transitions, settings, and interaction
owners. Keep `SessionOwner`, `ChatOwner`, media authorization, durable operations, and server
permissions authoritative. Introduce narrow presentation adapters where demo-specific state currently
prevents reuse. Do not make connected mode depend on demo persistence or fixture identities.

Patching the separate connected styles would retain two divergent presentations. Replacing data
owners with the demo reducer would break recovery and authorization. Shared presentation with
connected adapters preserves both the established interface and the backend contracts.

## Required corrections

1. Fence draft restoration after asynchronous storage by session, destination, view generation, and
   input identity. Completing old persistence must not overwrite a different view or later typing.
2. Preserve dirty profile text through avatar changes and remote profile revisions. Reconcile clean
   fields and detect conflicting edits rather than submitting stale clean fields with a new version.
3. Focus the attachment caption on desktop; touch must not open the keyboard unnecessarily.
4. A missing search message must not remove other results from its conversation.
5. Timeline date navigation must request remote date anchors outside the loaded history window.
6. Open the selected gallery item independently of neighboring authorization failures, with visible
   loading and cancellation; neighboring items load independently. The controller outlives virtual
   source rows, but session or actual access loss immediately clears the viewer.
7. Expose existing local General, Keyboard, theme, wallpaper, time, text-size, and power settings in
   connected mode. Apply the complete palette, follow system changes, and render the wallpaper.
   With no saved appearance preference, connected mode follows System as tweb does. Preserve every
   explicitly saved mode, including Classic, and preserve the demo's legacy migration.
8. Use the shared floating chat layout: default sidebars 360px, resize range 320–480px, chat content
   capped at 696px, 48px floating header, desktop 16px and handheld 8px chat inset. Preserve focus,
   scroll anchors, mounted composer, safe areas, and reduced-motion behavior.
9. Render connected photos, videos, albums, documents, and voice through the existing presentation
   primitives. Desktop ordinary media fit within 420×400px and handheld media within 340×340px;
   albums use actual dimensions. Pure media uses overlay metadata, voice/documents inline metadata.
   Documents retain extension, filename, size, and authorized download behavior. Pending and accepted
   media retain the same geometry; progress, retry, and cancellation occupy that structure. Persist
   optional local dimensions compatibly with old records and preserve occurrence identities.
10. Connect authorized media thumbnails to viewer source geometry for opening and closing, including
    occurrence identity and virtualized rows. Reduced motion uses the existing fallback.
11. Profiles and voter results use responsive, nonmodal sliding right panels. Desktop chat remains
    operable; mobile panels use the available width. Restore focus on close and keep access-removal
    fencing. Voter rows open the selected user; do not invent unsupported vote timestamps.
12. Account and community navigation participates in Back, Escape, focus restoration, and sidebar
    transitions without remounting the active conversation or discarding drafts.
    On handheld, Back dismisses the current information or voter-profile layer before leaving
    the conversation for the directory.
13. Render authorized contact avatars. Put removal/blocking in an appropriate danger-action menu
    with a named confirmation. Retain pagination and server privacy restrictions.
14. Restore selected-text copy and connected contact-card Add behavior using the authenticated
    identity and real contacts API, awaiting admission and preserving rejected card snapshots.
    Retain server authorization
    for transport-dependent actions and existing contact snapshot semantics.
15. Align call presentation with tweb's one-to-one call panel and top bar: desktop 400×580px initial
    panel, centered avatar/name/status, state gradient, circular icon controls, responsive video,
    explicit device settings, fullscreen, and coordinated transitions. A compact top bar always
    exposes mute, hangup, and restore. Preserve media nodes, tab ownership, server activation time,
    ringing, permissions, and recovery. Mirror a local front-facing preview appropriately.
16. Recording preview shows complete waveform, live playback position/time, and seek; recording
    capture and permission behavior stay intact. Use the reference pill/control geometry and
    appearance/disappearance motion. Share voice speed across messages, including 0.5/1/1.5/2.
17. Composer link previews display valid metadata, distinguish loading/unavailable results, and share
    the reply/edit helper slot. Dismissing the preview restores reply/edit context.
18. Attachment confirmation uses the reference 420px popup, actual-size single/album geometry,
    56px file rows and 48px icons, themed controls, and responsive placement.
19. Poll management actions belong in the context menu, without an extra permanent footer.
    Preserve authoritative votes, quizzes, edit/close permission, and the normal results footer.
20. Support reply swipe from ordinary media bubbles and desktop horizontal trackpad gestures while
    preserving native gestures on controls. Keep the 48px threshold and 64px cap, reference circular
    feedback, avatar movement, and 250ms recovery.
21. Search jumps carry keyword highlighting into the message without filtering the timeline.
22. Restore settings profile cover/search presentation; group/channel creation provides avatar
    selection and the reference corner Next action. Align the username/password auth scaffold with
    reference card/input dimensions and floating-label treatment without changing login semantics.

## Constraints

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
- No additional Telegram capabilities such as group calls, screen sharing, premium media editing,
  scheduled sends, or new authentication schemes are introduced.

## Validation

Use focused red/green regression checks, the complete frontend unit suite, TypeScript/build,
Prettier, and browser interaction/layout/motion checks at desktop and handheld widths. Exercise
reduced motion, dark/system themes, interrupted transitions, delayed responses, and dirty input.
Use the existing connected disposable runtime when available; report its actual limits, including
physical mobile browsers, rather than treating demo checks as backend acceptance.
