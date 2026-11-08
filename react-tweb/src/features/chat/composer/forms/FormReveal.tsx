import { motion, useReducedMotion } from 'motion/react';
import { useRef, type ReactNode } from 'react';
import styles from './ComposerListDialog.module.css';

const REVEAL_TRANSITION_SECONDS = 0.24;

interface FormRevealProps {
  isOpen: boolean;
  children: ReactNode;
}

/** Reveal dependent settings, then bring the completed section into the modal's viewport. */
export function FormReveal({ isOpen, children }: FormRevealProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  function revealExpandedSection() {
    const section = containerRef.current;
    const scrollContainer = section?.closest<HTMLElement>('[data-list-dialog-scroll]');
    if (!isOpen || !section || !scrollContainer || scrollContainer.clientHeight === 0) {
      return;
    }

    // Measure after expansion; scrolling to the opening frame would leave its final rows clipped.
    const sectionBounds = section.getBoundingClientRect();
    const viewportBounds = scrollContainer.getBoundingClientRect();
    const sectionCenter = sectionBounds.top + sectionBounds.height / 2;
    const viewportCenter = viewportBounds.top + viewportBounds.height / 2;
    scrollContainer.scrollBy({
      top: sectionCenter - viewportCenter,
      behavior: shouldReduceMotion ? 'instant' : 'smooth',
    });
  }

  return (
    <motion.div
      ref={containerRef}
      className={styles.reveal}
      initial={false}
      animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
      transition={{
        duration: shouldReduceMotion ? 0 : REVEAL_TRANSITION_SECONDS,
        ease: 'easeInOut',
      }}
      inert={!isOpen}
      aria-hidden={!isOpen}
      onAnimationComplete={revealExpandedSection}
    >
      {children}
    </motion.div>
  );
}
