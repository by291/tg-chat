import { motion, useIsPresent, useReducedMotion } from 'motion/react';
import { useId, type RefObject } from 'react';
import { CallControls, type CallControlsProps } from './CallControls';
import { CallGradient, type CallTone } from './CallGradient';
import { CallIdentity, type CallIdentityProps } from './CallIdentity';
import styles from './CallPanel.module.css';

const SLIDE_SECONDS = 0.25;

interface CompactBarProps extends CallControlsProps {
  presentation: CallIdentityProps & { tone: CallTone };
  mediaId: string;
  restoreRef: RefObject<HTMLButtonElement | null>;
  onRestore: () => void;
}

/** Slide compact controls and the workspace together while allowing immediate ownership changes. */
export function CallCompactBar({
  presentation,
  snapshot,
  owner,
  mediaId,
  restoreRef,
  onRestore,
}: CompactBarProps) {
  const isPresent = useIsPresent();
  const shouldReduceMotion = useReducedMotion();
  const statusId = useId();

  return (
    <motion.div
      className={styles.compactSlot}
      initial={{ height: 0 }}
      animate={{ height: 'auto' }}
      exit={{ height: 0 }}
      transition={{ duration: shouldReduceMotion ? 0 : SLIDE_SECONDS, ease: 'easeOut' }}
      inert={!isPresent}
      aria-hidden={!isPresent}
    >
      <section className={styles.panel} aria-label="Call" data-collapsed>
        <CallGradient tone={presentation.tone} />
        <button
          ref={restoreRef}
          className={styles.collapse}
          aria-label="Restore call panel"
          title="Restore call panel"
          aria-controls={mediaId}
          aria-expanded={false}
          aria-describedby={statusId}
          type="button"
          disabled={!isPresent}
          onClick={onRestore}
        />
        <CallIdentity {...presentation} statusId={statusId} />
        {snapshot.error && (
          <p className={styles.error} role="alert">
            {snapshot.error}
          </p>
        )}
        <CallControls snapshot={snapshot} owner={owner} isCompact isExiting={!isPresent} />
      </section>
    </motion.div>
  );
}
