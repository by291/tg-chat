# Third-party notices

## Telegram Web K wallpaper and visual reference

- Project: Telegram Web K / tweb
- Author: Eduard Kuzmenko
- Source: https://github.com/morethanwords/tweb
- Local source: `/Users/by291/code/js/tweb/public/assets/img/pattern.svg`
- Included asset: `public/assets/telegram-pattern.svg`, copied without modification
- Included sounds: `public/assets/audio/notification.mp3` and `message_sent.mp3`, copied
  without modification from tweb's `public/assets/audio/` directory
- Included geometry: the `message-tail-filled` SVG path from tweb's `index.html`, used in
  `src/features/chat/messages/MessageTail.tsx`
- Adapted album layout: `src/components/groupedLayout.ts`, used in
  `src/features/media/albumLayout.ts`; upstream credits the Telegram Desktop grouped layout
  implementation at https://github.com/telegramdesktop/tdesktop/blob/master/LEGAL
- Emoji-only size steps: `BIG_EMOJI_SIZES` in `src/components/chat/bubbles.ts`, used in
  `src/features/chat/messages/content/largeEmoji.ts`
- License: GNU General Public License, version 3

The full license text is included in `LICENSE`. Conversation data, account credentials, private
avatars, and messages from the observed Telegram account are not included in this project.

The React implementation was written for this project. The CSS uses measured visual
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

React, Vite, Ark UI, TanStack Virtual, Lucide, Motion, idb-keyval, Zod, emoji-regex, and development
dependencies retain their respective licenses in the installed packages. Exact versions are recorded
in `pnpm-lock.yaml`.

## MDN sample video

- Included asset: `public/assets/flower.mp4`
- Source: https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4
- Collection: MDN interactive examples, CC0 video samples
- Purpose: on-demand playback in regular and circular message frames

`public/assets/evening-window.svg`, `public/assets/sample-tone.wav`, and the example text document
were created for this project. The audio is a generated four-second tone, not a person's recording.

## Public Telegram sticker packs

The following public packs were downloaded through the Telegram Bot API with TStickers on
November 7, 2026. The bundled `.tgs` files are unchanged gzip-compressed Lottie animations:

- Duck: https://t.me/addstickers/UtyaDuck (40 stickers)
- Cubigator: https://t.me/addstickers/Crocosaurus (30 stickers)
- Shark Animated (@TgSticker): https://t.me/addstickers/shark_animated (48 stickers)

Files are located under `public/assets/stickers/`, grouped by Telegram pack name. Each WebP
preview is a 100 × 100 first-frame rendering generated locally with rlottie-python. The catalog
preserves Telegram file-unique IDs, pack order, and associated emoji. English search terms are
also derived from the downloaded filenames produced by TStickers.

Provenance and per-file SHA-256 checksums are recorded in `public/assets/stickers/SOURCES.json`.
Sticker artwork remains the property of its respective creators. Public availability does not
relicense the artwork under this project's GPL license; no separate artwork license is asserted.
No private chat media, bot credentials, or API response caches are included.

Download tool: https://github.com/FHPythonUtils/TStickers (MIT).
Preview renderer: https://github.com/laggykiller/rlottie-python.
Neither tool is a runtime dependency of the React application.

Emoji Mart and `@emoji-mart/data` provide Unicode emoji metadata and search under the MIT
license. Lottie Web provides animation playback under the MIT license. Standard Unicode emoji glyphs are drawn
by the operating system. The separately bundled custom emoji artwork is listed below.

## Public Telegram custom emoji

Downloaded from the Telegram Bot API on November 7, 2026:

- Face Emoji: https://t.me/addemoji/FaceEmoji (56 custom emoji)
- Hand Emoji: https://t.me/addemoji/HandEmoji (64 custom emoji)
- Gold Utya | @EmojisTG: https://t.me/addemoji/GoldUtyaEmoji (200 custom emoji)

The 11 monochrome search category animations were resolved from the document IDs rendered
by Telegram K's emoji search. Category API reference: https://core.telegram.org/api/emoji-categories.
They are tinted locally while preserving their animated alpha, matching the repaintable asset usage.

Original TGS files and locally rendered 100 × 100 WebP previews are stored under
`public/assets/emoji/`. `SOURCES.json` records SHA-256 checksums. The catalog retains Telegram
custom emoji document IDs, original pack order and Unicode fallback metadata. Credentials,
private account data and API response caches are not bundled.

Artwork belongs to its respective creators. Public availability does not relicense the artwork
under this project's GPL license; no separate artwork license is asserted.

Lexical and `@lexical/react` provide the inline emoji editor under the MIT license:
https://github.com/facebook/lexical.

## Theme picker animated emoji

The nine TGS files under `public/assets/theme-emoji/` are Telegram Animated Emoji artwork,
retrieved from the [Telemoji mirror](https://github.com/saeedtahmtan/telemoji) on 2026-11-08.
The mirror credits Telegram as the artwork author; the original artwork retains its upstream
terms and is not relicensed by this project. Playback uses the existing Lottie dependency.
See [Telegram animated emoji documentation](https://core.telegram.org/api/animated-emojis).

Local palette labels are unchanged. Peach, Ocean, and Sunset use the supported orange heart,
blue heart, and sun animations because their previous Unicode symbols lack animated assets
in this collection.
