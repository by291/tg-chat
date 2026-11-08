# Startup Shell Implementation Plan

**Goal:** Show the background and sidebar frame before conversation content is ready.

**Authorization:** The user approved the source-backed staged startup approach. Preserve current
storage formats and existing lazy loading; add no asynchronous component boundaries.

**Architecture:** A small inline HTML/CSS frame covers application module loading outside the React
root. React mounts the real wallpaper and a noninteractive sidebar placeholder beneath it. Once
conversation restoration finishes, the original frame fades out over 150ms and is removed. Visible
conversation rows fade in over 150ms each, staggered by 15ms. Reduced motion skips both transitions.
The cover is inert and never intercepts pointer input; the wallpaper and application layout
remain mounted.

**Constraints:** Use existing theme preferences without adding storage keys. The HTML frame uses
a light/dark fallback and saved solid colors; React resolves complete palettes and image wallpaper.
Keep mobile sidebar geometry aligned with the ready application, including deep-linked chats.

- [x] Add a delayed-storage regression proving that wallpaper and sidebar appear before data,
      no demo conversation is exposed, and the wallpaper survives restoration.
- [x] Add the HTML frame, shared sidebar placeholder styling, and early theme fallback.
- [x] Remove the full-page readiness return; gate data-dependent sidebar and conversation content.
- [x] Verify storage failure still reaches the usable demo UI with an error notice.
- [x] Check cold startup with application scripts blocked, desktop/mobile layouts, and dark mode.
- [x] Run the full test suite, build, formatting, and whitespace checks.
- [x] Fade the retained HTML frame and stagger visible rows, with reduced-motion, click-through,
      offscreen-row, and Strict Mode coverage.
- [x] Document Telegram Web K's startup and optional-feature/media lazy-loading boundaries.

## Verification

- Regression: delaying IndexedDB initially failed because the wallpaper was absent; after the
  change the shell appears immediately and keeps the same wallpaper node through restoration.
- 96 test files and 485 tests passed. TypeScript and Vite production build passed.
- Existing large-bundle warning remains; this change improves first paint without reducing code
  size.
- Blocking the built application entry still showed the initial patterned background and sidebar.
- Desktop sidebar bounds stayed at left/top 16px, width 320px, height 688px in a 1280x720 viewport.
- Mobile bounds stayed at left/top 8px, width 374px, height 828px in a 390x844 viewport.
- Saved dark mode applied before the blocked application entry; mobile chat deep links opened
  normally.
- Browser network blocking, cache disabling, and device emulation were restored after verification.
- Independent static review found no blocking issue in startup, data isolation, or theme handoff.
- Browser frame sampling confirmed ordered row opacity progression and final full visibility.
  The frame disappeared while later rows completed their fade; temporary instrumentation was
  removed.
