import publicPacks from './publicStickerPacks.json';

export const STICKER_MESSAGE_SIZE = 200;

export interface Sticker {
  id: string;
  name: string;
  emoji: string;
  keywords: string;
  packId: string;
  source: string;
  preview: string;
  renderer: 'canvas' | 'svg';
}

function getPreviewPath(packId: string, filename: string) {
  return `/assets/stickers/${packId}/${filename.replace('.tgs', '.webp')}`;
}

export const STICKER_PACKS = publicPacks.map((pack) => ({
  id: pack.id,
  name: pack.name,
  url: pack.url,
  preview: getPreviewPath(pack.id, pack.stickers[0].filename),
}));

export const STICKERS: Sticker[] = publicPacks.flatMap((pack) =>
  pack.stickers.map((sticker): Sticker => ({
    id: sticker.id,
    name: sticker.name,
    emoji: sticker.emoji,
    keywords: sticker.keywords,
    packId: pack.id,
    source: `/assets/stickers/${pack.id}/${sticker.filename}`,
    preview: getPreviewPath(pack.id, sticker.filename),
    // SVG handles the track mattes used by a small number of original stickers.
    renderer: sticker.renderer === 'svg' ? 'svg' : 'canvas',
  })),
);

/** Resolve a message's stable identifier to an installed local sticker. */
export function findSticker(id: string): Sticker | undefined {
  return STICKERS.find((sticker) => sticker.id === id);
}
