# Bubble style audit

Checked on November 6, 2026 against the local tweb source and the authorized Telegram dev chat.
This is a partial visual implementation, not complete Telegram bubble parity.

## Corrections applied

| Area              | React behavior after this audit                                                        | Owning tweb source                      |
| ----------------- | -------------------------------------------------------------------------------------- | --------------------------------------- |
| Vertical spacing  | 2px within groups, 6px after groups; included in measured row height                   | `_chatVariables.scss`                   |
| Group boundary    | Adjacent messages from the same sender group through 121 seconds, inclusive            | `bubbleGroups.ts`                       |
| Text              | 16px text, 21px line height, 4px/8px/5px padding                                       | `base.scss`, `_chatBubble.scss`         |
| Sender            | 14px name, 18px line height, medium weight                                             | `_chatBubble.scss`                      |
| Timestamp         | 12px text, inline space reservation, visible time aligned to the final line            | `_chatBubble.scss`                      |
| Corners           | 15px exposed corners, 5px grouped corners, square corner where a tail joins            | `_chatBubble.scss`                      |
| Tail              | Original 11 × 20 SVG geometry, 8.4px outward offset, mirrored for outgoing messages    | `index.html`, `_chatBubble.scss`        |
| Shadow            | `0 1px 2px rgb(16 35 47 / 15%)`                                                        | `_chatBubble.scss`                      |
| Width             | 480px desktop maximum; narrower mobile allowance                                       | `_chat.scss`, `_chatBubble.scss`        |
| Avatar            | 40px diameter and 46px sender-column reservation, without increasing row height        | `bubbleGroups.ts`, `_chat.scss`         |
| Photos and videos | 1px frame border; grouped corner inheritance; no extra 4px inset                       | `_chatBubble.scss`                      |
| Caption           | Text padding separate from the media frame; square media edges beside headers/captions | `_chatBubble.scss`                      |
| Media timestamp   | 18px overlay, 3px bottom/right inset                                                   | `_chatBubble.scss`                      |
| Reply             | 14px text, 18px line height, 42px minimum height, optional 32px preview                | `_chatPinned.scss`, `replyContainer.ts` |
| Forward           | 14px header, 18px line height                                                          | `_chatBubble.scss`                      |
| Reactions         | 30px chips, 22px emoji, 15px count; time follows the reaction row                      | `_reaction.scss`                        |
| Link preview      | Message text precedes its preview                                                      | `bubbles.ts`                            |
| Service event     | 15px text, 20px line height, 4.5px vertical padding                                    | `_chatBubble.scss`                      |

Source root: `/Users/by291/code/js/tweb/src/`. SCSS partials are under `scss/partials/`;
chat sources are under `components/chat/`. The SVG symbol is in the repository's root `index.html`.
The original tail's license is recorded in `THIRD_PARTY_NOTICES.md`.

`MessageMetadata.tsx` contains an inaccessible hidden copy for width reservation and one visible,
accessible copy. This matches tweb's layout strategy without measuring strings in JavaScript.
`MessageTail.tsx` owns the copied geometry. Corner state remains explicit in the bubble CSS module.

## Remaining differences

- Avatars appear at the group end but do not stick to the viewport bottom within a long group.
  Private conversations still use the demonstration's group-style sender shell.
- Pure emoji messages are ordinary text. Sticker fixtures use native emoji, without Telegram's
  animated sticker/custom emoji assets, emoji-only sizing, or animated reactions.
- Albums use a fixed two-column grid, rather than tweb's aspect-ratio-dependent mosaic.
  Plain-media tails that sample the image edge are not implemented.
- Regular and circular videos use native playback controls. Voice messages use a simplified
  waveform; transcription, download states, and Telegram's exact playback chrome are absent.
- File/contact/link/poll cards retain simplified structures, icons, and state transitions. Poll
  dimensions and typography are closer, but vote animations and percentages are not a full port.
- Reply previews omit rich quotes, custom emoji, deleted-media state, and animated thumbnails.
  Forward headers omit source avatars, channel attribution variants, and linked navigation.
- Reaction chips represent this device's reactions. Counts, participant avatars, custom emoji,
  selected/unselected server states, and decorative animations are not reproduced.
- Entry/highlight/menu animations remain the demo's Motion/Ark implementations. The full tweb
  sending, selection, deletion, and media-opening choreography has not been reproduced.
- The light outgoing color matches the observed Telegram theme. Dark mode, alternative themes,
  font preferences, and locale-specific emoji rendering are not pixel-verified.

## Verification

- 38 behavior tests pass, including the 121/122-second grouping boundary.
- TypeScript, production build, formatting, and whitespace checks pass.
- Desktop DOM measurements confirm 16px body text, 12px time, conditional tail presence, and
  grouped corner states. The dev conversation exercises captions, replies, and reactions.
- At a verified 390px viewport, Message lab has no horizontal history overflow. The observed
  outgoing bubble overflow is the intentional 8.4px tail; body content stays within its box.
- These are targeted Chrome checks. They do not establish full browser or pixel parity.

Screenshots: [desktop](./screenshots/bubble-style-desktop.png),
[mobile](./screenshots/bubble-style-mobile.png).
