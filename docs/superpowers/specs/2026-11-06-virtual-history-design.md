# Virtual History and Message Variants

The local React study needs a bounded DOM window and message-specific layouts matching Web K.
The user requested alignment with tweb and `/Users/by291/devel/js/virtual-demo`.

## Approach

Use TanStack Virtual with stable row keys, measured heights, end anchoring, and conditional append
following. This follows the local demo while avoiding a second handwritten scroll compensation
system. tweb's own history is a sliced DOM window with ScrollSaver restoration; copying its
imperative renderer would obscure the React learning goal.

Keep the message model backward compatible. Add a validated media union for video, album, document,
voice, link preview, contact, and poll, plus forward and service metadata. Existing photo and sticker
messages continue working. Shared bubble chrome owns sender, reply, metadata, reactions, and actions;
content renderers own the distinct media layouts. Reserve photo/video geometry before decoding.

Add a Message lab conversation with a deterministic long history and a showcase of variants.
Existing browser data must survive the upgrade. History paging is local; MTProto is out of scope.

## Required behavior

- Render only the visible range and overscan, even after all local history is loaded.
- Load older rows near the top without moving the visible reading anchor.
- Follow appended output only near the bottom; explicit sends and Jump to latest reach the end.
- Navigation resolves IDs before mounting rows, so replies and pinned messages can target history.
- Preserve grouping across page boundaries; date and service rows interrupt groups.
- Do not replay message entry animation when virtual rows remount.
- Support local poll votes, playable sample media, file download, and album photo viewing.
- Use CSS Modules, Ark UI, readable English source, and the existing Prettier configuration.

## Verification

Test row grouping, paging/navigation, geometry, persistence compatibility, and poll transitions.
Use real browser scrolling to verify bounded DOM, prepend anchoring, distant jumps, resize, and media.
Keep unsupported Telegram capabilities explicit: MTProto, animated sticker formats, live locations,
payments, and channel-specific administration are outside this local conversation study.
