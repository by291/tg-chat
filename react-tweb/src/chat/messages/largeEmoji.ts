import emojiRegex from 'emoji-regex';
import type { Message } from '../model';
import { splitEmojiText } from '../emoji/customEmojiEntities';

// Telegram Web K reduces standalone emoji size as their count increases, capped at seven.
// prettier-ignore
const EMOJI_SIZES = [
  96,
  90,
  84,
  72,
  60,
  48,
  36,
];
const INVISIBLE_TEXT = /[\s\ufe0f]/g;
const STRUCTURED_TEXT = /<(?:pre|code|blockquote|ul|ol|table)\b|data-formula=/i;

type EmojiMessage = Pick<Message, 'text'> & Partial<Message>;

/** Size emoji-only messages while counting joined sequences and custom emoji once. */
export function getLargeEmojiSize(message: EmojiMessage) {
  const hasOtherContent = Boolean(
    message.attachment || message.media || message.sticker || message.isService,
  );
  const hasStructuredText =
    (message.textStyle && message.textStyle !== 'plain') ||
    (message.richText && STRUCTURED_TEXT.test(message.richText));
  if (hasOtherContent || hasStructuredText) {
    return undefined;
  }

  let count = 0;
  for (const part of splitEmojiText(message)) {
    if (part.documentId) {
      count += 1;
      continue;
    }
    const pattern = emojiRegex();
    const matches = [...part.text.matchAll(pattern)];
    const remainder = part.text.replace(pattern, '').replace(INVISIBLE_TEXT, '');
    if (remainder) {
      return undefined;
    }
    count += matches.length;
  }
  return count ? EMOJI_SIZES[Math.min(count, EMOJI_SIZES.length) - 1] : undefined;
}
