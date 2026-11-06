import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import styles from './ChatSidebar.module.css';

const SELECTION_FADE_SECONDS = 0.2;

interface SidebarPageHeaderProps {
  children: ReactNode;
  selection?: ReactNode;
}

/** Keep each page header mounted underneath its temporary selection toolbar. */
export function SidebarPageHeader({ children, selection }: SidebarPageHeaderProps) {
  const shouldReduceMotion = useReducedMotion();
  const isSelecting = Boolean(selection);

  return (
    <div className={styles.headerSlot}>
      <AnimatePresence initial={false}>
        {isSelecting && (
          <motion.div
            key="selection"
            className={styles.selectionPlate}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : SELECTION_FADE_SECONDS }}
          >
            {selection}
          </motion.div>
        )}
      </AnimatePresence>
      <div inert={isSelecting} aria-hidden={isSelecting}>
        {children}
      </div>
    </div>
  );
}
