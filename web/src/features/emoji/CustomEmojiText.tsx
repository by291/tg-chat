import { findCustomEmoji } from './customEmojiCatalog';
import { splitEmojiText, type EmojiText } from '@/domain/messages/customEmoji';
import { StickerArtwork } from '@/features/stickers/StickerArtwork';
import styles from './CustomEmojiText.module.css';

/** Render local Telegram emoji inline and retain readable fallback text for missing assets. */
export function CustomEmojiText(value: EmojiText) {
  return splitEmojiText(value).map((part) => {
    const emoji = part.documentId ? findCustomEmoji(part.documentId) : undefined;
    if (!emoji) {
      return part.text;
    }
    return (
      <span key={part.offset} className={styles.emoji} data-custom-emoji={emoji.id}>
        <StickerArtwork sticker={emoji} />
      </span>
    );
  });
}
