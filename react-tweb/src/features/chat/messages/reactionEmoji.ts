import { findCustomEmoji, type CustomEmoji } from '@/features/emoji/customEmojiCatalog';

const CUSTOM_REACTION_PREFIX = 'custom:';
const UNKNOWN_CUSTOM_EMOJI = '❔';

interface ReactionEmoji {
  label: string;
  native: string;
  custom?: CustomEmoji;
}

/** Keep a custom Telegram document distinct from its native emoji fallback in stored reactions. */
export function getCustomReactionKey(id: string) {
  return `${CUSTOM_REACTION_PREFIX}${id}`;
}

/** Resolve native or custom stored reactions without requiring their original picker to remain open. */
export function resolveReactionEmoji(value: string): ReactionEmoji {
  if (!value.startsWith(CUSTOM_REACTION_PREFIX)) {
    return { label: value, native: value };
  }

  const custom = findCustomEmoji(value.slice(CUSTOM_REACTION_PREFIX.length));
  if (!custom) {
    return { label: 'Unknown custom emoji', native: UNKNOWN_CUSTOM_EMOJI };
  }

  return {
    label: custom.name,
    native: custom.emoji,
    custom,
  };
}
