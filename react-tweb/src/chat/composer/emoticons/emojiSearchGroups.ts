import {
  Heart,
  ThumbsUp,
  ThumbsDown,
  PartyPopper,
  Laugh,
  CircleAlert,
  Frown,
  Angry,
  Meh,
  CircleHelp,
  Smile,
  type LucideIcon,
} from 'lucide-react';

export interface EmojiSearchGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  emoticons: string[];
}

// Unicode groups observed in Telegram K; custom server emoji are outside the local catalog.
export const EMOJI_SEARCH_GROUPS: EmojiSearchGroup[] = [
  {
    id: 'love',
    label: 'Love',
    icon: Heart,
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
    icon: ThumbsUp,
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
    icon: ThumbsDown,
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
    icon: PartyPopper,
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
    icon: Laugh,
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
    icon: CircleAlert,
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
    icon: Frown,
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
    icon: Angry,
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
    icon: Meh,
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
    icon: CircleHelp,
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
    icon: Smile,
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
