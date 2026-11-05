# React Telegram Conversation Study

## Intent

Rebuild the observed Telegram Web K conversation experience as a readable React learning project.
The user approved a local demonstration with simulated conversations and autonomous implementation.
Create the application in `react-tweb/`, inside the existing empty repository.

## Constraints

- React, TypeScript, Vite, pnpm, Ark UI React, and CSS Modules.
- Follow the supplied global engineering instructions, including descriptive English identifiers,
  public function comments, semantic spacing, at most three nesting levels, and a 100-column limit.
- Keep conversation code together; share only genuinely reusable presentation primitives.
- No Telegram authentication or network messages. Use invented demonstration contacts.
- Preserve upstream attribution for copied wallpaper artwork.

## Approaches

1. Reuse the original imperative renderer inside React. This preserves upstream behavior but hides
   the React learning goal and brings the Telegram runtime into a local demonstration.
2. Reimplement the conversation domain with React state and headless Ark UI components. Selected
   by the implementer because the user explicitly delegated implementation decisions and requested
   a local demonstration. It makes ownership and interactions visible in ordinary React code.
3. A static visual mockup would be smaller, but would not satisfy the requested interaction study.

## Experience

- Match the observed floating 360px conversation list, centered 696px conversation column,
  rounded 48px toolbar/composer, pastel wallpaper, cyan outgoing bubbles, and purple accent.
- Include working chat switching, draft preservation, conversation filtering, message search,
  reply/edit/delete, reactions, pinning, image attachments and preview, and group information.
- Include keyboard submission with IME protection, multiline input, empty-input protection,
  jump to latest, reply navigation, message entry animation, and reduced-motion support.
- Save messages and drafts locally. Show storage errors rather than silently promising persistence.
- Adapt to mobile with a back button and one primary pane at a time.
- Implement emoji and sticker selection locally; omit remote GIF search and real calls.

## Architecture

`src/chat/` owns the conversation state, fixture content, message model, composer, timeline,
sidebar, and details. `src/shared/` owns small presentation primitives used across these parts.
Ark UI provides menu, dialog, popover, and tab semantics. Motion animates message entry.
IndexedDB stores structured state and attachment data through idb-keyval.
CSS variables centralize measured geometry, colors, and timing.

## Reference Evidence

- Observed `https://web.telegram.org/k/#-5493284452` on November 5, 2026.
- Local reference: `/Users/by291/code/js/tweb`.
- `src/scss/partials/_chatVariables.scss`: 15px/5px bubble radii, 4px/5px/8px text padding,
  2px/6px message spacing, and 200ms composer transitions.
- `src/scss/partials/_chatTopbar.scss`: floating rounded toolbar and independent plates.
- `src/scss/partials/_chat.scss`: centered width and coordinated composer/history movement.
- `public/assets/img/pattern.svg`: upstream wallpaper artwork, retained with GPL attribution.

## Boundaries

This is a local interaction study, not a complete Telegram client. Calls, server delivery receipts,
remote media search, full rich-text editing, and unbounded virtual history are outside this version.
Documentation must identify these boundaries and explain how React replaces upstream ownership.
