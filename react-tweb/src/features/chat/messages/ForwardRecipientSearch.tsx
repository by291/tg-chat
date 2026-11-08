import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { Search, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type Ref } from 'react';
import { Avatar } from '@/components/Avatar';
import type { Conversation } from '../model';
import styles from './ForwardRecipientSearch.module.css';

const TRANSITION_SECONDS = 0.15;
const MIN_SEARCH_HEIGHT = 48;
const MAX_SEARCH_HEIGHT = 132;
const HIDDEN_CHIP_SCALE = 0.2;
const SEARCH_PADDING = 9;
// Match CSS ease, which differs from Motion's named easing presets.
// prettier-ignore
const SELECTOR_EASING = [
  0.25,
  0.1,
  0.25,
  1,
] as const;

// The reference reverses its entry keyframes, including their easing direction.
// prettier-ignore
const EXIT_EASING = [
  0.75,
  0,
  0.75,
  0.9,
] as const;

interface RecipientChipProps {
  recipient: Conversation;
  onRemove: (recipient: Conversation) => void;
  ref?: Ref<HTMLButtonElement>;
}

interface ForwardRecipientSearchProps {
  recipients: Conversation[];
  query: string;
  onQueryChange: (query: string) => void;
  onRemove: (recipient: Conversation) => void;
}

function RecipientChip({ recipient, onRemove, ref }: RecipientChipProps) {
  const isPresent = useIsPresent();
  const shouldReduceMotion = useReducedMotion();
  const hiddenScale = shouldReduceMotion ? 1 : HIDDEN_CHIP_SCALE;

  return (
    <motion.button
      ref={ref}
      type="button"
      className={styles.chip}
      layout={shouldReduceMotion ? false : 'position'}
      initial={{ opacity: 0, scale: hiddenScale }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{
        opacity: 0,
        scale: hiddenScale,
        transition: { duration: TRANSITION_SECONDS, ease: EXIT_EASING },
      }}
      transition={{ duration: TRANSITION_SECONDS, ease: SELECTOR_EASING }}
      inert={!isPresent}
      aria-hidden={!isPresent}
      aria-label={`Remove ${recipient.title}`}
      onClick={() => onRemove(recipient)}
    >
      <span className={styles.avatar}>
        <Avatar initials={recipient.initials} color={recipient.color} size="small" />
        <span className={styles.removeIcon} aria-hidden="true">
          <X size={22} />
        </span>
      </span>
      <span className={styles.title}>{recipient.title}</span>
    </motion.button>
  );
}

/** Keep selected recipients, search input, and wrapping height in one animated layout. */
export function ForwardRecipientSearch({
  recipients,
  query,
  onQueryChange,
  onRemove,
}: ForwardRecipientSearchProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(MIN_SEARCH_HEIGHT);
  const shouldReduceMotion = useReducedMotion();
  const lastRecipientId = recipients.at(-1)?.id;

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }

    function measureHeight() {
      const contentHeight = content?.offsetHeight ?? MIN_SEARCH_HEIGHT;
      setHeight(Math.min(MAX_SEARCH_HEIGHT, Math.max(MIN_SEARCH_HEIGHT, contentHeight)));
    }

    measureHeight();
    const observer = new ResizeObserver(measureHeight);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const input = inputContainerRef.current;
    if (!viewport || !input || !lastRecipientId) {
      return;
    }

    // Use the capped target height so the scroll does not fight the height transition.
    const inputBottom = input.offsetTop + input.offsetHeight + SEARCH_PADDING;
    viewport.scrollTo({
      top: Math.max(0, inputBottom - MAX_SEARCH_HEIGHT),
      behavior: shouldReduceMotion ? 'instant' : 'smooth',
    });
  }, [lastRecipientId, shouldReduceMotion]);

  return (
    <motion.div
      ref={viewportRef}
      className={styles.viewport}
      layoutScroll
      initial={false}
      animate={{ height }}
      transition={{ duration: shouldReduceMotion ? 0 : TRANSITION_SECONDS, ease: SELECTOR_EASING }}
    >
      <div ref={contentRef} className={styles.content}>
        {/* Departing chips leave flex flow immediately; their neighbors can move while they shrink. */}
        <AnimatePresence initial={false} mode="popLayout">
          {recipients.map((recipient) => (
            <RecipientChip key={recipient.id} recipient={recipient} onRemove={onRemove} />
          ))}
        </AnimatePresence>
        <motion.div
          ref={inputContainerRef}
          className={styles.inputContainer}
          layout={shouldReduceMotion ? false : 'position'}
          transition={{ duration: TRANSITION_SECONDS, ease: SELECTOR_EASING }}
        >
          <Search size={22} aria-hidden="true" />
          <input
            aria-label="Search recipients"
            placeholder="Search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </motion.div>
      </div>
    </motion.div>
  );
}
