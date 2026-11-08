import type { CustomEmoji } from '@/features/emoji/customEmojiCatalog';
import { StickerArtwork } from '@/features/stickers/StickerArtwork';
import styles from './EmojiPicker.module.css';

/** Insert a custom emoji entity while retaining the picker and composer selection. */
export function CustomEmojiCell({
  emoji,
  onSelect,
}: {
  emoji: CustomEmoji;
  onSelect: (emoji: CustomEmoji) => void;
}) {
  return (
    <button
      type="button"
      className={styles.customEmojiCell}
      aria-label={`${emoji.name} ${emoji.emoji}`}
      onPointerDown={(event) => {
        // Keep search focus while inserting into the composer's saved selection.
        if (event.pointerType === 'mouse') {
          event.preventDefault();
        }
      }}
      onClick={() => onSelect(emoji)}
    >
      <StickerArtwork sticker={emoji} />
    </button>
  );
}
