import categoryIcons from '../../emoji/searchCategoryIcons.json';

export interface EmojiSearchGroup {
  id: string;
  label: string;
  emoticons: string[];
}

// Unicode fallbacks match both native emoji and Telegram custom emoji in each emotion group.
export const EMOJI_SEARCH_GROUPS: EmojiSearchGroup[] = [
  {
    id: 'love',
    label: 'Love',
    // prettier-ignore
    emoticons: [
      '❤',
      '😍',
      '🥰',
      '😘',
      '☺',
      '🤗',
      '😚',
      '😙',
      '💋',
      '🍑',
      '👄',
      '🫦',
      '😻',
      '❤‍🔥',
      '💗',
      '💞',
      '💕',
      '💖',
      '🧡',
      '💛',
      '💚',
      '💙',
      '💜',
      '🖤',
      '🤍',
      '🤎',
      '💓',
      '💘',
      '💝',
      '💟',
      '👩‍❤‍👨',
      '👩‍❤‍👩',
      '💑',
      '👨‍❤‍👨',
      '👩‍❤‍💋‍👨',
      '👩‍❤‍💋‍👩',
      '💏',
      '👨‍❤‍💋‍👨',
    ],
  },
  {
    id: 'approval',
    label: 'Approval',
    // prettier-ignore
    emoticons: [
      '👍',
      '👏',
      '👌',
      '💪',
      '😌',
      '✌',
      '🤝',
      '✔',
      '🆗',
      '✅',
    ],
  },
  {
    id: 'disapproval',
    label: 'Disapproval',
    // prettier-ignore
    emoticons: [
      '👎',
      '😒',
      '🤮',
      '🤢',
      '🤦‍♂',
      '🤦‍♀',
      '🙅‍♀',
      '🙅‍♂',
    ],
  },
  {
    id: 'cheers',
    label: 'Cheers',
    // prettier-ignore
    emoticons: [
      '🎉',
      '🥳',
      '🤩',
      '🎊',
      '🥂',
      '🍾',
      '🌟',
      '🍻',
      '🎂',
      '💃',
      '🎁',
    ],
  },
  {
    id: 'laughter',
    label: 'Laughter',
    // prettier-ignore
    emoticons: [
      '😄',
      '😁',
      '😆',
      '😅',
      '😂',
      '🤣',
      '😀',
      '🤭',
      '😃',
      '😬',
      '😈',
    ],
  },
  {
    id: 'astonishment',
    label: 'Astonishment',
    // prettier-ignore
    emoticons: [
      '😨',
      '😦',
      '😱',
      '😯',
      '😧',
      '😮',
      '😲',
      '🤯',
      '😵',
      '😳',
      '🫣',
      '😰',
    ],
  },
  {
    id: 'sadness',
    label: 'Sadness',
    // prettier-ignore
    emoticons: [
      '😔',
      '😪',
      '😭',
      '😢',
      '😣',
      '😞',
      '🥺',
      '💔',
      '☹',
      '😕',
      '🙁',
      '🥲',
      '😒',
      '😥',
      '😫',
      '😮‍💨',
      '🫤',
      '😟',
    ],
  },
  {
    id: 'anger',
    label: 'Anger',
    // prettier-ignore
    emoticons: [
      '😡',
      '🤬',
      '👿',
      '😠',
      '😤',
      '🖕',
      '💢',
    ],
  },
  {
    id: 'neutral',
    label: 'Neutral',
    // prettier-ignore
    emoticons: [
      '😐',
      '😑',
      '😕',
      '😶',
      '🙃',
      '🙂',
      '🫠',
      '🤐',
      '🥶',
    ],
  },
  {
    id: 'doubt',
    label: 'Doubt',
    // prettier-ignore
    emoticons: [
      '🤔',
      '🤨',
      '🧐',
      '🙄',
      '🥸',
      '😵‍💫',
      '❓',
      '🤷‍♀',
      '🤷‍♂',
    ],
  },
  {
    id: 'silly',
    label: 'Silly',
    // prettier-ignore
    emoticons: [
      '🤪',
      '😜',
      '😝',
      '😛',
      '🤡',
      '🥴',
    ],
  },
];

/** Match presentation and skin-tone variants against the same Telegram search group. */
export function normalizeGroupEmoji(emoji: string) {
  return emoji.replace(/[\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, '');
}

/** Filter local sticker tags using group membership instead of English keyword guesses. */
export function matchesEmojiGroup(emoji: string, group: EmojiSearchGroup) {
  const normalizedEmoji = normalizeGroupEmoji(emoji);
  return group.emoticons.some((emoticon) => normalizedEmoji.includes(emoticon));
}

/** Resolve the exact animated category icon observed in Telegram's emoji search. */
export function getSearchCategoryIcon(group: EmojiSearchGroup) {
  const icon = categoryIcons.find((entry) => entry.category === group.id);
  if (!icon) {
    return undefined;
  }
  const path = `/assets/emoji/SearchCategories/${icon.id}`;
  const renderer: 'canvas' | 'svg' = icon.renderer === 'svg' ? 'svg' : 'canvas';
  return { name: group.label, source: `${path}.tgs`, preview: `${path}.webp`, renderer };
}
