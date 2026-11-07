import { StickerArtwork } from '../stickers/StickerArtwork';
import { resolveReactionEmoji } from './reactionEmoji';
import styles from './MessageBubble.module.css';

interface MessageReactionProps {
  emoji: string;
  messageId: string;
  onReact: (messageId: string, emoji: string) => void;
}

/** Render a native or custom reaction while preserving its identity when toggled. */
export function MessageReaction({ emoji, messageId, onReact }: MessageReactionProps) {
  const reaction = resolveReactionEmoji(emoji);
  return (
    <span className={styles.reactionPosition} data-reaction-position>
      <button
        type="button"
        aria-label={`Remove ${reaction.label} reaction`}
        onClick={() => onReact(messageId, emoji)}
      >
        <span className={styles.reactionEmoji} data-reaction-emoji={emoji}>
          {reaction.custom ? <StickerArtwork sticker={reaction.custom} /> : reaction.native}
        </span>
        <span className={styles.reactionCount}>1</span>
      </button>
    </span>
  );
}
