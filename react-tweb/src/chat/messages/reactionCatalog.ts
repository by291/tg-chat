import type { EmojiMartData } from '@emoji-mart/data';
import { EMOJI_CATEGORY_NAMES } from '../composer/emoticons/emojiCatalog';
import type { PickerSection } from '../composer/emoticons/PickerGrid';
import { CUSTOM_EMOJI_PACKS, type CustomEmoji } from '../emoji/customEmojiCatalog';
import { POPULAR_REACTIONS } from './reactionChoices';
import { getCustomReactionKey } from './reactionEmoji';

export interface ReactionOption {
  value: string;
  label: string;
  native: string;
  searchText: string;
  custom?: CustomEmoji;
}

function createNativeSections(catalog: EmojiMartData): PickerSection<ReactionOption>[] {
  const categories = catalog.categories.filter((category) => category.id !== 'frequent');
  return categories.map((category) => {
    const items: ReactionOption[] = [];
    for (const id of category.emojis) {
      const emoji = catalog.emojis[id];
      if (!emoji) {
        continue;
      }
      const searchText = `${emoji.name} ${emoji.keywords.join(' ')}`.toLocaleLowerCase();
      for (const skin of emoji.skins) {
        items.push({
          value: skin.native,
          label: skin.native,
          native: skin.native,
          searchText,
        });
      }
    }
    return {
      id: category.id,
      title: EMOJI_CATEGORY_NAMES[category.id] ?? category.id,
      items,
    };
  });
}

/** Build reaction choices from the same Unicode catalog and local packs as the composer. */
export function createReactionCatalog(catalog?: EmojiMartData): PickerSection<ReactionOption>[] {
  const nativeSections = catalog ? createNativeSections(catalog) : [];
  const nativeOptions = new Map<string, ReactionOption>();
  for (const section of nativeSections) {
    for (const option of section.items) {
      nativeOptions.set(option.value, option);
    }
  }
  const popular = POPULAR_REACTIONS.map((native) => {
    return (
      nativeOptions.get(native) ?? {
        value: native,
        label: native,
        native,
        searchText: native,
      }
    );
  });
  const customSections = CUSTOM_EMOJI_PACKS.map((pack) => ({
    id: pack.id,
    title: pack.name,
    items: pack.emojis.map((custom): ReactionOption => {
      const nativeSearchText = nativeOptions.get(custom.emoji)?.searchText ?? '';
      return {
        value: getCustomReactionKey(custom.id),
        label: custom.name,
        native: custom.emoji,
        searchText: `${pack.name} ${custom.name} ${nativeSearchText}`.toLocaleLowerCase(),
        custom,
      };
    }),
  }));

  return [
    {
      id: 'popular',
      title: 'Popular reactions',
      items: popular,
    },
    ...nativeSections,
    ...customSections,
  ];
}

/** Search all supported reactions without duplicating popular entries or merging custom artwork. */
export function searchReactionCatalog(options: {
  sections: PickerSection<ReactionOption>[];
  query: string;
}): PickerSection<ReactionOption>[] {
  const query = options.query.trim().toLocaleLowerCase();
  if (!query) {
    return options.sections;
  }

  const matches = new Map<string, ReactionOption>();
  for (const section of options.sections) {
    for (const item of section.items) {
      if (item.searchText.includes(query) || item.native.includes(query)) {
        matches.set(item.value, item);
      }
    }
  }
  return [{ id: 'results', title: 'Search Results', items: Array.from(matches.values()) }];
}
