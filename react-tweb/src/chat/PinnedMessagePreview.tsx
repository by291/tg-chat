import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { describeMessage } from './messageFormatting';
import type { Message } from './model';
import styles from './PinnedMessagePreview.module.css';

const CONTENT_DURATION_MS = 200;
const CONTENT_DURATION_SECONDS = CONTENT_DURATION_MS / 1000;
const TEXT_TRAVEL = 20;
const MEDIA_TRAVEL = 40;
const ROW_VARIANTS = {
  enter: (offset: number) => ({ y: offset, opacity: 0 }),
  visible: { y: 0, opacity: 1 },
  exit: (offset: number) => ({ y: -offset, opacity: 0 }),
};

interface PinnedMessagePreviewProps {
  message: Message;
  index: number;
  count: number;
}

interface RollingRowProps {
  contentKey: string;
  direction: number;
  distance: number;
  children: ReactNode;
}

function getThumbnail(message: Message) {
  if (message.attachment) {
    return message.attachment.url;
  }
  switch (message.media?.kind) {
    case 'album':
      return message.media.photos[0].url;
    case 'video':
      return message.media.poster;
    case 'link':
      return message.media.image?.url;
    default:
      return undefined;
  }
}

function RollingRow({ contentKey, direction, distance, children }: RollingRowProps) {
  const shouldReduceMotion = useReducedMotion();
  const offset = shouldReduceMotion ? 0 : direction * distance;

  return (
    <AnimatePresence initial={false} custom={offset}>
      <motion.span
        key={contentKey}
        className={styles.rollingRow}
        custom={offset}
        variants={ROW_VARIANTS}
        initial="enter"
        animate="visible"
        exit="exit"
        transition={{ duration: CONTENT_DURATION_SECONDS, ease: 'easeInOut' }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

/** Animate the subtitle, media, and changed counter digits without moving the pinned title. */
export function PinnedMessagePreview({ message, index, count }: PinnedMessagePreviewProps) {
  const shouldReduceMotion = useReducedMotion();
  const isLatest = index === count - 1;
  const thumbnail = getThumbnail(message);
  const [transition, setTransition] = useState({
    messageId: message.id,
    index,
    direction: -1,
    counter: index + 1,
    thumbnail,
  });

  // Keep direction stable through unrelated renders and retain the number while it scales out.
  const hasSelectionChanged = transition.messageId !== message.id || transition.index !== index;
  const hasNewThumbnail = Boolean(thumbnail && thumbnail !== transition.thumbnail);
  if (hasSelectionChanged || hasNewThumbnail) {
    const nextDirection = index < transition.index ? -1 : 1;
    setTransition({
      messageId: message.id,
      index,
      direction: hasSelectionChanged ? nextDirection : transition.direction,
      counter: isLatest ? transition.counter : index + 1,
      thumbnail: thumbnail ?? transition.thumbnail,
    });
  }

  useEffect(() => {
    if (thumbnail) {
      return;
    }
    // Keep the outgoing image until the scale-out finishes, then release the hidden media row.
    const timeout = window.setTimeout(() => {
      setTransition((previous) => ({ ...previous, thumbnail: undefined }));
    }, CONTENT_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [thumbnail]);

  const counterDigits = String(transition.counter).split('');
  const digitOffset = shouldReduceMotion ? 0 : transition.direction * TEXT_TRAVEL;

  return (
    <span className={styles.content} data-media={Boolean(thumbnail)} aria-hidden="true">
      <span className={styles.media}>
        {transition.thumbnail && (
          <RollingRow
            contentKey={transition.thumbnail}
            direction={transition.direction}
            distance={MEDIA_TRAVEL}
          >
            <img src={transition.thumbnail} alt="" />
          </RollingRow>
        )}
      </span>
      <span className={styles.summary}>
        <strong className={styles.title}>
          Pinned Message{' '}
          <span className={styles.counter} data-hidden={isLatest}>
            #
            <AnimatePresence initial={false} custom={digitOffset}>
              {counterDigits.map((digit, position) => (
                <motion.span
                  className={styles.digit}
                  key={position}
                  custom={digitOffset}
                  variants={ROW_VARIANTS}
                  initial="enter"
                  animate="visible"
                  exit="exit"
                  transition={{ duration: CONTENT_DURATION_SECONDS, ease: 'easeInOut' }}
                >
                  <span className={styles.digitPlaceholder}>{digit}</span>
                  <RollingRow
                    contentKey={digit}
                    direction={transition.direction}
                    distance={TEXT_TRAVEL}
                  >
                    {digit}
                  </RollingRow>
                </motion.span>
              ))}
            </AnimatePresence>
          </span>
        </strong>
        <span className={styles.subtitle}>
          <RollingRow
            contentKey={message.id}
            direction={transition.direction}
            distance={TEXT_TRAVEL}
          >
            {describeMessage(message)}
          </RollingRow>
        </span>
      </span>
    </span>
  );
}
