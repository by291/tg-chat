import type { Emoji, EmojiMartData } from '@emoji-mart/data';
import { z } from 'zod';

export const EMOJI_CATEGORY_NAMES: Record<string, string> = {
  people: 'Smileys & People',
  nature: 'Animals & Nature',
  foods: 'Food & Drink',
  activity: 'Activity',
  places: 'Travel & Places',
  objects: 'Objects',
  symbols: 'Symbols',
  flags: 'Flags',
};

export const DEFAULT_RECENT_EMOJI = [
  'grinning',
  'joy',
  'kissing_heart',
  'heart',
  'heart_eyes',
  'blush',
  'grin',
  '+1',
  'relaxed',
  'pensive',
  'smile',
  'sob',
  'kiss',
  'smirk',
  'flushed',
  'stuck_out_tongue_winking_eye',
  'see_no_evil',
  'wink',
  'cry',
  'stuck_out_tongue_closed_eyes',
  'scream',
  'rage',
  'unamused',
  'disappointed',
  'sweat_smile',
  'kissing',
  'speak_no_evil',
  'relieved',
  'smiley',
  'yum',
  'laughing',
  'ok_hand',
];

const searchResultSchema = z.array(z.object({ id: z.string() })).nullable();
let catalogPromise: Promise<EmojiMartData> | undefined;

/** Load the catalog and search index only when the picker is first opened. */
export function loadEmojiCatalog() {
  if (!catalogPromise) {
    catalogPromise = Promise.all([
      import('@emoji-mart/data/sets/15/native.json'),
      import('emoji-mart'),
    ])
      .then(async ([catalogModule, emojiMart]) => {
        const catalog: EmojiMartData = catalogModule.default;
        await emojiMart.init({ data: catalog });
        return catalog;
      })
      .catch((error: unknown) => {
        catalogPromise = undefined;
        throw error;
      });
  }
  return catalogPromise;
}

/** Keep Emoji Mart's untyped search boundary out of the rendering components. */
export async function searchEmoji(query: string): Promise<Emoji[]> {
  const catalog = await loadEmojiCatalog();
  const { SearchIndex } = await import('emoji-mart');
  const result: unknown = await SearchIndex.search(query);
  const matches = searchResultSchema.parse(result) ?? [];
  return matches.map((match) => catalog.emojis[match.id]).filter(Boolean);
}
