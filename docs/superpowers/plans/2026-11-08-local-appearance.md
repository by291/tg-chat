# Local Appearance Implementation Plan

**Goal:** Port the local Telegram Web K theme and wallpaper workflow into General Settings.

**Architecture:** A single persistent appearance store owns mode, per-mode theme choices, and
wallpaper overrides. CSS variables provide palettes to the entire document, including portals.
Wallpaper rendering and upload storage stay separate from message state and layout.

**Tech Stack:** React, TypeScript, Zod, IndexedDB through idb-keyval, CSS, existing sidebar controls.

## Scope and Decisions

The user selected the entire local appearance workflow. Use the existing checkout and branch.
Include Classic, Night, Day, Dark, System Default, local theme cards, Dark accent colors,
gradient and solid wallpaper choices, local image upload, blur, reset, and persistent settings.
Use the checked-out tweb theme presets and palette definitions as the source of colors.
Cloud account synchronization and downloading the authenticated cloud catalog are outside scope.
The existing appearance is retained as a selectable local theme to avoid a surprise visual reset.
Keep existing dark-mode reveal animation and reduced-motion behavior.
Keep uploaded images in IndexedDB and store only identifiers in preferences.
Do not commit until the user requests grouped commits.

## Tasks

- [x] Add behavior tests for mode resolution, isolated per-mode choices, persisted reload,
  corrupted preferences, and unavailable storage. Verify failures, then implement appearance store.
- [x] Add source-derived theme palettes and wallpaper rendering; replace hardcoded app background.
  Migrate the legacy dark preference once and route menu toggling through appearance state.
- [x] Add Color Theme card strip, five mode radios, Dark accent strip, and wallpaper navigation.
  Use existing sidebar transitions and settings controls. Test selection and nested navigation.
- [x] Add wallpaper grid, color entry, image validation and local persistence, blur, and reset.
  Test invalid uploads and preservation of unrelated theme state.
- [x] Run full tests, TypeScript/build, Prettier and diff checks. Compare actual TG settings UI
  against the local app, including selection, refresh persistence, dark mode, and wallpaper reset.

## Review Focus

- Switching brightness must not discard the other mode's wallpaper or theme selection.
- System appearance changes must update root CSS and the menu's displayed mode together.
- Upload failures must retain the previous background and show useful feedback.
- A late image decode must not overwrite a newer theme or leak object URLs.
- Portals, outgoing text, and bubble tails must remain legible with each palette.

## Progress

- Completed a single appearance store, source-derived local palettes, theme previews, and
  wallpaper rendering with per-mode persistence.
- Compared local controls with the running Telegram settings and checked-out tweb source.
  The bundled catalog contains nine local themes; it does not fetch Telegram cloud themes.
- Browser checks passed for theme selection, mode switching, custom HEX/RGB colors,
  independent Dark accent/wallpaper selection, image upload, blur, refresh, and reset.
- Independent review found and fixed Day outgoing-content contrast, Dark accent overriding
  explicit wallpaper selection, and stale view-transition callbacks overriding newer modes.
- Full suite: 74 files and 392 tests passed. Production build, TypeScript, Prettier, and
  whitespace checks passed. Vite retains its large-chunk advisory.
- Restored Classic/Diamond after verification. Screenshot: `/tmp/tg-appearance-aligned.jpg`.
- The user requested grouped commits after implementation and browser verification.

## Layout Regression Follow-up

- Reproduced a 16px horizontal application scroll on reload: the mounted theme picker used
  `scrollIntoView`, which also scrolled its hidden ancestors.
- Scoped theme navigation to the picker strip and prevented focus from scrolling ancestors.
  The application viewport now uses `overflow: clip` so offscreen panels cannot scroll it.
- Browser verification passed on reload, settings entry/exit, and keyboard navigation to the
  final theme. The sidebar remains 16px from the left edge and the right white strip is gone.
