import { Check } from 'lucide-react';
import type { PollMedia } from './messageMedia';
import styles from './MessageBody.module.css';

const PERCENTAGE_SCALE = 100;

/** Display locally persisted poll results and let this device change its selection. */
export function PollMessage({
  poll,
  onVote,
}: {
  poll: PollMedia;
  onVote: (optionId: string) => void;
}) {
  const totalVotes = poll.options.reduce((total, option) => total + option.votes, 0);
  const hasVoted = Boolean(poll.selectedOptionId);

  return (
    <section className={styles.poll} aria-label={poll.question}>
      <strong>{poll.question}</strong>
      <small>Anonymous poll · local demo</small>
      <div className={styles.pollOptions}>
        {poll.options.map((option) => {
          const percentage = totalVotes
            ? Math.round((option.votes / totalVotes) * PERCENTAGE_SCALE)
            : 0;
          const isSelected = poll.selectedOptionId === option.id;
          return (
            <button key={option.id} aria-pressed={isSelected} onClick={() => onVote(option.id)}>
              <span className={styles.pollChoice}>{isSelected && <Check size={14} />}</span>
              <span className={styles.pollOptionText}>
                <span>{option.text}</span>
                {hasVoted && (
                  <span className={styles.pollBar} style={{ width: `${percentage}%` }} />
                )}
              </span>
              {hasVoted && <strong>{percentage}%</strong>}
            </button>
          );
        })}
      </div>
      <small>{totalVotes} votes</small>
    </section>
  );
}
