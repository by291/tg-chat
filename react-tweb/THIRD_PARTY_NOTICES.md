# Third-party notices

## Telegram Web K wallpaper and visual reference

- Project: Telegram Web K / tweb
- Author: Eduard Kuzmenko
- Source: https://github.com/morethanwords/tweb
- Local source: `/Users/by291/code/js/tweb/public/assets/img/pattern.svg`
- Included asset: `public/assets/telegram-pattern.svg`, copied without modification
- Included geometry: the `message-tail-filled` SVG path from tweb's `index.html`, used in
  `src/chat/messages/MessageTail.tsx`
- License: GNU General Public License, version 3

The full license text is included in `LICENSE`. Conversation data, account credentials, private
avatars, and messages from the observed Telegram account are not included in this project.

The React implementation was written for this learning project. The CSS uses measured visual
properties from the referenced project. The original landscape illustration is in
`public/assets/quiet-hills.svg`.

## Roboto fonts

- Project: https://github.com/googlefonts/roboto
- License: Apache License 2.0; the full text is in `public/assets/fonts/LICENSE.txt`
- Included assets: `roboto-regular-latin.woff2` and `roboto-medium-latin.woff2`
- Source: the unchanged Latin 400 and 500 webfonts referenced by tweb's
  `src/scss/fonts/_roboto.scss`, renamed for readability

These fonts are served locally so text metrics do not depend on an installed system font.

## Package dependencies

React, Vite, Ark UI, TanStack Virtual, Lucide, Motion, idb-keyval, Zod, and development dependencies retain their
respective licenses in the installed packages. Exact versions are recorded in `pnpm-lock.yaml`.

## MDN sample video

- Included asset: `public/assets/flower.mp4`
- Source: https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4
- Collection: MDN interactive examples, CC0 video samples
- Purpose: on-demand playback in regular and circular message frames

`public/assets/evening-window.svg`, `public/assets/sample-tone.wav`, and the example text document
were created for this study. The audio is a generated four-second tone, not a person's recording.
