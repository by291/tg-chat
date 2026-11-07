import { Check } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import styles from './ComposerListDialog.module.css';

const ANSWER_MODE_TRANSITION_SECONDS = 0.2;

interface PollCorrectAnswerProps {
  label: string;
  groupName: string;
  isChecked: boolean;
  canChooseMultiple: boolean;
  onSelect: () => void;
}

/** Keep correct-answer selection outside the editable option's border. */
export function PollCorrectAnswer({
  label,
  groupName,
  isChecked,
  canChooseMultiple,
  onSelect,
}: PollCorrectAnswerProps) {
  const inputType = canChooseMultiple ? 'checkbox' : 'radio';
  const shouldReduceMotion = useReducedMotion();

  return (
    <label className={styles.correctAnswer}>
      <input
        type={inputType}
        name={groupName}
        aria-label={label}
        checked={isChecked}
        onChange={onSelect}
      />
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={inputType}
          className={styles.answerSymbol}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{
            duration: shouldReduceMotion ? 0 : ANSWER_MODE_TRANSITION_SECONDS,
            ease: 'easeOut',
          }}
          aria-hidden="true"
        >
          <span className={styles.answerGlyph} data-type={inputType} data-checked={isChecked}>
            {canChooseMultiple && <Check size={14} strokeWidth={3} />}
          </span>
        </motion.span>
      </AnimatePresence>
    </label>
  );
}
