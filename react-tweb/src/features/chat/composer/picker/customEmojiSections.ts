import type { Emoji } from '@emoji-mart/data';
import {
  CUSTOM_EMOJI_PACKS,
  findCustomEmoji,
  type CustomEmoji,
} from '@/features/emoji/customEmojiCatalog';
import { matchesEmojiGroup, normalizeGroupEmoji, type EmojiSearchGroup } from './emojiSearchGroups';
import type { PickerSection } from './PickerGrid';

export type EmojiPickerItem =
  | {
      kind: 'unicode';
      emoji: Emoji;
    }
  | {
      kind: 'custom';
      emoji: CustomEmoji;
    };

interface CustomSectionOptions {
  sections: PickerSection<Emoji>[];
  recentIds: string[];
  query: string;
  selectedGroup?: EmojiSearchGroup;
  matches: Emoji[];
  shouldIncludeCustomEmoji?: boolean;
}

/** Merge local Telegram packs with Unicode results without conflating their identities. */
export function createCustomEmojiSections(
  options: CustomSectionOptions,
): PickerSection<EmojiPickerItem>[] {
  const sections = options.sections.map((section): PickerSection<EmojiPickerItem> => ({
    ...section,
    items: section.items.map((emoji) => ({ kind: 'unicode', emoji })),
  }));
  if (options.shouldIncludeCustomEmoji === false) {
    return sections;
  }
  const recent = sections.find((section) => section.id === 'recent');
  if (recent) {
    const nativeById = new Map(recent.items.map((item) => [item.emoji.id, item]));
    recent.items = options.recentIds.flatMap((id): EmojiPickerItem[] => {
      const custom = findCustomEmoji(id);
      if (custom) {
        return [{ kind: 'custom', emoji: custom }];
      }
      const native = nativeById.get(id);
      return native ? [native] : [];
    });
  }

  const query = options.query.trim().toLowerCase();
  const matchedNative = new Set(
    options.matches.map((emoji) => normalizeGroupEmoji(emoji.skins[0].native)),
  );
  for (const pack of CUSTOM_EMOJI_PACKS) {
    const items = pack.emojis.filter((emoji) => {
      if (options.selectedGroup) {
        return matchesEmojiGroup(emoji.emoji, options.selectedGroup);
      }
      if (!query) {
        return true;
      }
      return (
        emoji.name.toLowerCase().includes(query) ||
        emoji.emoji.includes(query) ||
        matchedNative.has(normalizeGroupEmoji(emoji.emoji))
      );
    });
    if (items.length) {
      sections.push({
        id: pack.id,
        title: pack.name,
        items: items.map((emoji) => ({ kind: 'custom', emoji })),
      });
    }
  }
  return sections;
}
