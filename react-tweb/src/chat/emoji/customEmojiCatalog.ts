import packs from './publicEmojiPacks.json';

export interface CustomEmoji {
  id: string;
  name: string;
  emoji: string;
  packId: string;
  source: string;
  preview: string;
  renderer: 'canvas' | 'svg';
}

export const CUSTOM_EMOJI_PACKS = packs.map((pack) => ({
  id: pack.id,
  name: pack.name,
  url: pack.url,
  emojis: pack.emojis.map((entry): CustomEmoji => {
    const path = `/assets/emoji/${pack.id}/${entry.id}`;
    return {
      ...entry,
      packId: pack.id,
      source: `${path}.tgs`,
      preview: `${path}.webp`,
      renderer: entry.renderer === 'svg' ? 'svg' : 'canvas',
    };
  }),
}));

export const CUSTOM_EMOJI = CUSTOM_EMOJI_PACKS.flatMap((pack) => pack.emojis);
const emojiById = new Map(CUSTOM_EMOJI.map((emoji) => [emoji.id, emoji]));

/** Resolve Telegram document IDs without depending on pack order or display names. */
export function findCustomEmoji(id: string) {
  return emojiById.get(id);
}
