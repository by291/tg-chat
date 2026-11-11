import { motion, type MotionStyle } from 'motion/react';
import { Ripple } from '@/components/Ripple';
import { MessageCheckbox } from '../../selection/MessageCheckbox';
import { usePollResultAnimation } from './usePollResultAnimation';
import styles from './PollMessage.module.css';

interface PollOptionProps {
  text: string;
  percentage: number;
  votes: number;
  canVote: boolean;
  hasResults: boolean;
  isSelected: boolean;
  isMultiple: boolean;
  isQuiz: boolean;
  isCorrect: boolean;
  onChoose: () => void;
}

/** Keep the option row stationary as its choice turns into a percentage and result line. */
export function PollOption({
  text,
  percentage,
  votes,
  canVote,
  hasResults,
  isSelected,
  isMultiple,
  isQuiz,
  isCorrect,
  onChoose,
}: PollOptionProps) {
  const frame = usePollResultAnimation({ hasResults, percentage });
  const hasChosenMark = frame.stage === 'result' && (isSelected || isQuiz);
  const resultTone = isCorrect ? 'correct' : 'wrong';
  const quizLabel = isCorrect ? ', correct answer' : ', incorrect answer';
  const optionLabel = hasResults ? `${text}, ${percentage}%, ${votes} votes` : text;
  const accessibleLabel = isQuiz ? `${optionLabel}${quizLabel}` : optionLabel;

  return (
    <button
      type="button"
      className={styles.option}
      aria-label={accessibleLabel}
      aria-pressed={isSelected}
      disabled={!canVote}
      data-stage={frame.stage}
      data-tone={isQuiz ? resultTone : undefined}
      onClick={onChoose}
    >
      <span className={styles.choiceContainer}>
        <span className={styles.choice}>
          <MessageCheckbox isChecked={isSelected} isRound={!isMultiple} />
        </span>
        {frame.stage === 'result' && (
          <motion.span className={styles.percentage}>{frame.percentageText}</motion.span>
        )}
      </span>
      <span className={styles.optionLabel}>
        <span className={styles.optionText}>
          {text}
          {isQuiz && isCorrect && !hasResults && (
            <span className={styles.correctAnswer}>Correct answer</span>
          )}
        </span>
        {hasResults && votes > 0 && <span className={styles.voterCount}>{votes}</span>}
        {frame.stage === 'path' && (
          <svg
            className={styles.path}
            width="52"
            height="28"
            viewBox="0 0 52 28"
            aria-hidden="true"
          >
            <path
              d="M2 10L2 18A8 8 0 0 0 10 26L42 26"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray="3.6 96.4"
            />
          </svg>
        )}
        {frame.stage === 'result' && (
          <motion.span
            className={styles.progress}
            role="meter"
            aria-label={`${text} votes`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
            style={{ '--progress': frame.progress } as MotionStyle}
          >
            <span className={styles.progressFill} />
          </motion.span>
        )}
        {hasChosenMark && (
          <span className={styles.chosenMark}>
            <MessageCheckbox isChecked isRound={!isMultiple} isCross={isQuiz && !isCorrect} />
          </span>
        )}
        {hasChosenMark && isQuiz && isSelected && <span className={styles.chosenDot} />}
      </span>
      <Ripple />
    </button>
  );
}
