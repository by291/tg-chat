# Virtual history verification

Verified on November 6, 2026, using the local development server in Chrome.

## Automated checks

- `pnpm test`: 38 behavior tests across 11 files.
- `pnpm build`: TypeScript checks and the production bundle.
- `pnpm format:check`: the repository's Prettier configuration.

Regression coverage includes media geometry before decoding, date and sender boundaries, older
history expansion, absent navigation targets, version-1 storage upgrades, local poll vote replacement,
repeated photos in albums, search replies, resize anchor restoration, and initial navigation under
React Strict Mode.

The virtual positioning tests run the actual TanStack Virtual implementation against explicit
JSDOM viewport and row dimensions. They do not replace the virtualizer with a mock. Real browser
checks remain necessary for layout and native scrolling.

## Browser observations

- The Message lab has 1,018 messages and 1,021 rows including date separators.
- After an unloaded reply jump, all 1,021 rows were available while only 24 rows were mounted.
  The target, archive note 12, was positioned 360px below the desktop viewport's top edge.
- Mounted row counts in observed scrolling samples ranged from 14 to 28, including overscan.
- Scrolling to the loaded history boundary expanded the available window by 80 rows.
- First opening and reloading the conversation settled at the latest message without loading an
  extra history page. User gestures enable automatic older-history loading.
- A 390px mobile-to-desktop resize retained archive note 8 at -54.5px. Returning to mobile retained
  the same message at -52.5px, a two-pixel rounding difference.
- A search for `Scroll up to explore` retained its reply preview. Clicking it closed search,
  exposed older history, and mounted archive note 12 rather than returning to the bottom.
- Opening the third album tile, whose source repeats the first tile, opened photo 82 of 82.
- Selecting `Media layouts` updated the local poll to 17 votes and marked that choice selected.
- Voice playback changed the control to Pause. The local sample video reached readyState 4,
  advanced playback time, and played to completion.
- The viewport override was reset after mobile checks. The live preview remains open.
- Bubble spacing matches tweb: 2px within a sender group and 6px after its last message.
  Browser measurements confirmed both distances; padding includes them in virtual row heights.

## Findings resolved during verification

- Width invalidation previously discarded the reading position. The last stable key and row
  offset are now retained before ResizeObserver callbacks can reorder measurements.
- Search originally built reply lookup from only matched rows; it now uses the full conversation.
- The initial bottom jump could overwrite a reply jump when leaving search; explicit navigation
  now owns initial positioning.
- Strict Mode effect cleanup previously cancelled the one-shot initial jump; the post-commit
  request is now cancellable and recreated during effect remounting.
- Album tiles with identical source URLs now have distinct gallery identities.
- A padding shorthand had erased the within-group gap. Group-end padding now follows tweb's
  spacing rules, and fractional row measurements avoid adding a rounding gap between bubbles.

## Scope and limits

These were targeted desktop/mobile browser checks, not a complete browser automation suite or a
Safari/iOS test run. Network delay, remote history, and simultaneous tabs were not tested.
The DOM is bounded; local message storage and IndexedDB snapshots remain whole-conversation data.
Video uses native controls, audio uses an original sample tone, and polls are local.

Screenshot: [message variants](./screenshots/message-variants.png).
