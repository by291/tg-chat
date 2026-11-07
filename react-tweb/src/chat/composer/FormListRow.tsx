import { motion, useIsPresent, useReducedMotion } from 'motion/react';
import type { DragEventHandler, ReactNode } from 'react';
import styles from './ComposerListDialog.module.css';

const ROW_TRANSITION_SECONDS = 0.2;
const POLL_OPTION_GAP = 12;

interface FormListRowProps {
  children: ReactNode;
  hasGap: boolean;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
  onRevealComplete: () => void;
}

/** Animate row space and contents together while keeping departing fields out of keyboard navigation. */
export function FormListRow({
  children,
  hasGap,
  onDragOver,
  onDrop,
  onRevealComplete,
}: FormListRowProps) {
  const isPresent = useIsPresent();
  const shouldReduceMotion = useReducedMotion();
  const duration = shouldReduceMotion ? 0 : ROW_TRANSITION_SECONDS;
  const marginTop = hasGap ? POLL_OPTION_GAP : 0;

  return (
    <motion.div
      className={styles.entryRow}
      layout="position"
      initial={{ height: 0, marginTop: 0, opacity: 0 }}
      animate={{ height: 'auto', marginTop, opacity: 1 }}
      exit={{ height: 0, marginTop: 0, opacity: 0 }}
      transition={{ duration, ease: 'easeOut' }}
      inert={!isPresent}
      aria-hidden={!isPresent}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onAnimationComplete={() => {
        if (isPresent) {
          onRevealComplete();
        }
      }}
    >
      {children}
    </motion.div>
  );
}
