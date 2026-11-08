import { Check, Mic, Send } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { IconButton } from '@/components/IconButton';
import styles from './MessageComposer.module.css';

const ICON_TRANSITION = {
  duration: 0.4,
  reducedDuration: 0.2,
  initialScale: 0.5,
  overshootScale: 1.1,
  initialOpacity: 0.8,
  exitOpacity: 0.4,
};

interface ComposerSendButtonProps {
  isEditing: boolean;
  hasContent: boolean;
  isPreparingAttachment: boolean;
  onSend: () => void;
}

/** Animate icon changes independently from the button's stable hit target and keyboard focus. */
export function ComposerSendButton({
  isEditing,
  hasContent,
  isPreparingAttachment,
  onSend,
}: ComposerSendButtonProps) {
  const shouldReduceMotion = useReducedMotion();
  let mode = 'voice';
  let label = 'Record voice message';
  let Icon = Mic;
  if (hasContent) {
    mode = 'send';
    label = 'Send message';
    Icon = Send;
  }
  if (isEditing) {
    mode = 'edit';
    label = 'Save message';
    Icon = Check;
  }
  const isDisabled = mode === 'voice' || isPreparingAttachment;
  const initialScale = shouldReduceMotion ? 1 : ICON_TRANSITION.initialScale;
  const duration = shouldReduceMotion ? ICON_TRANSITION.reducedDuration : ICON_TRANSITION.duration;
  const exitOpacity = shouldReduceMotion ? 0 : [ICON_TRANSITION.exitOpacity, 0];
  const scale = shouldReduceMotion
    ? 1
    : [ICON_TRANSITION.initialScale, ICON_TRANSITION.overshootScale, 1];

  return (
    <IconButton
      label={label}
      className={styles.sendButton}
      disabled={isDisabled}
      data-mode={mode}
      onClick={onSend}
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={mode}
          className={styles.sendGlyph}
          aria-hidden="true"
          initial={{ scale: initialScale, opacity: ICON_TRANSITION.initialOpacity }}
          animate={{ scale, opacity: 1 }}
          exit={{ scale: initialScale, opacity: exitOpacity }}
          transition={{ duration, ease: 'easeInOut' }}
        >
          <Icon />
        </motion.span>
      </AnimatePresence>
    </IconButton>
  );
}
