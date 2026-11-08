# Appearance Motion Alignment

## Design

Match the inspected Telegram Web K transition routes: settings selections use a 250ms ease
crossfade; only the menu toggle supplies a circular reveal origin (600ms in, 500ms out).
Prepare image wallpapers before publishing a choice so colors and decoded pixels enter the same
snapshot. Keep the last visible wallpaper during preparation and ignore superseded requests.
Use one transition owner for modes, palettes, accents, wallpaper colors, images, blur, and reset.
Do not add independent CSS color fades on top of the document transition.

## Verification Plan

- Cover ordering, late callbacks, failed image preparation, and interrupted transitions.
- Verify image resources remain alive while visible and release after replacement.
- Match theme selection rings and explicit emoji playback timing to the reference.
- Respect reduced motion and suspend heavy background playback during snapshot transitions.
- Compare settings changes and menu toggles in the browser, including uploaded wallpapers.
- Run the full suite, production build, formatting, and whitespace checks.

## Validation

- The full suite passed: 76 files and 399 tests. Production build and Prettier checks passed.
- Browser checks confirmed the 250ms settings fade, menu reveal/conceal routes, decoded image
  readiness, image blur transitions, wallpaper replacement, and nine loaded emoji players.
- Restored Classic/Diamond and Night/Diamond without uploaded-image overrides; preserved 24-hour
  time formatting. Saved the final browser view to `/tmp/tg-theme-motion-aligned.jpg`.
- Three theme decorations use available animated equivalents: Peach uses an orange heart,
  Ocean uses a blue heart, and Sunset uses a sun. Preset labels and colors remain unchanged.
