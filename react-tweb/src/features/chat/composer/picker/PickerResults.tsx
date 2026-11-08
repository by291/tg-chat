import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import styles from './EmojiPicker.module.css';

const RESULTS_FADE_SECONDS = 0.2;
// Telegram's Animated cross-fade uses its standard transition curve.
// prettier-ignore
const RESULTS_FADE_EASING = [
  0.4,
  0,
  0.2,
  1,
] as const;

interface PickerResultsProps {
  viewKey: string;
  children: ReactNode;
}

function ResultsLayer({ children }: { children: ReactNode }) {
  const isPresent = useIsPresent();
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      className={styles.resultsLayer}
      data-exiting={!isPresent}
      inert={!isPresent}
      aria-hidden={!isPresent}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{
        duration: shouldReduceMotion ? 0 : RESULTS_FADE_SECONDS,
        ease: RESULTS_FADE_EASING,
      }}
    >
      {children}
    </motion.div>
  );
}

/** Overlap outgoing and incoming results without letting the fading grid receive input. */
export function PickerResults({ viewKey, children }: PickerResultsProps) {
  return (
    <div className={styles.results}>
      <AnimatePresence initial={false}>
        <ResultsLayer key={viewKey}>{children}</ResultsLayer>
      </AnimatePresence>
    </div>
  );
}
