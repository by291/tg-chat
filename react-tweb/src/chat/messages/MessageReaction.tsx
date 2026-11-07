import { useLayoutEffect, useRef } from 'react';
import { StickerArtwork } from '../stickers/StickerArtwork';
import { resolveReactionEmoji } from './reactionEmoji';
import { launchReactionFlight } from './reactionFlight';
import { prepareReactionLayout } from './reactionLayoutTransition';
import styles from './MessageBubble.module.css';

interface MessageReactionProps {
  emoji: string;
  messageId: string;
  onReact: (messageId: string, emoji: string) => void;
}

/** Render a reaction destination and consume only its explicitly held local selection. */
export function MessageReaction({ emoji, messageId, onReact }: MessageReactionProps) {
  const reaction = resolveReactionEmoji(emoji);
  const emojiRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const target = emojiRef.current;
    if (target) {
      // The flight owns cleanup: Strict Mode effect replay must not reveal it before landing.
      launchReactionFlight({ messageId, emoji, target });
    }
  }, [emoji, messageId]);

  return (
    <span className={styles.reactionPosition} data-reaction-position>
      <button
        type="button"
        aria-label={`Remove ${reaction.label} reaction`}
        onClick={(event) => {
          const row = event.currentTarget.closest<HTMLElement>('[data-message-id]');
          if (row) {
            prepareReactionLayout({ row });
          }
          onReact(messageId, emoji);
        }}
      >
        <span ref={emojiRef} className={styles.reactionEmoji} data-reaction-emoji={emoji}>
          {reaction.custom ? <StickerArtwork sticker={reaction.custom} /> : reaction.native}
        </span>
        <span className={styles.reactionCount}>1</span>
      </button>
    </span>
  );
}
