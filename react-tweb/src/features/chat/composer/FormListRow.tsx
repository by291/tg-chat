import { motion, useIsPresent, useReducedMotion } from 'motion/react';
import { useSortable } from '@dnd-kit/react/sortable';
import type { ReactNode } from 'react';
import styles from './ComposerListDialog.module.css';

const ROW_TRANSITION_SECONDS = 0.2;
const POLL_OPTION_GAP = 12;

interface FormListRowProps {
  id: string;
  index: number;
  isDisabled: boolean;
  children: (controls: { handleRef: (element: Element | null) => void }) => ReactNode;
  hasGap: boolean;
  onRevealComplete: () => void;
}

/** Animate row space and contents together while keeping departing fields out of keyboard navigation. */
export function FormListRow({
  children,
  id,
  index,
  isDisabled,
  hasGap,
  onRevealComplete,
}: FormListRowProps) {
  const isPresent = useIsPresent();
  const shouldReduceMotion = useReducedMotion();
  const sortable = useSortable({
    id,
    index,
    disabled: isDisabled || !isPresent,
    transition: shouldReduceMotion ? null : undefined,
  });
  const duration = shouldReduceMotion ? 0 : ROW_TRANSITION_SECONDS;
  const marginTop = hasGap ? POLL_OPTION_GAP : 0;

  return (
    <div ref={sortable.ref}>
      <motion.div
        className={styles.entryRow}
        initial={{
          height: 0,
          marginTop: 0,
          opacity: 0,
        }}
        animate={{
          height: 'auto',
          marginTop,
          opacity: 1,
        }}
        exit={{
          height: 0,
          marginTop: 0,
          opacity: 0,
        }}
        transition={{ duration, ease: 'easeOut' }}
        inert={!isPresent}
        aria-hidden={!isPresent}
        onAnimationComplete={() => {
          if (isPresent) {
            onRevealComplete();
          }
        }}
      >
        {children({ handleRef: sortable.handleRef })}
      </motion.div>
    </div>
  );
}
