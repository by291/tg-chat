import { Check, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MAX_POLL_OPTIONS, MAX_POLL_OPTION_LENGTH, type PollMedia } from '../messageMedia';
import type { MessageInteraction } from '../messageInteraction';
import { getSelectedPollOptions } from '../state/pollVoting';
import styles from './MessageBody.module.css';

const PERCENTAGE_SCALE = 100;
const MAX_TIMEOUT = 2_147_483_647;

/** Render a local poll with explicit submission, quiz results, and revoting rules. */
export function PollMessage({
  poll,
  onInteract,
}: {
  poll: PollMedia;
  onInteract: (interaction: MessageInteraction) => void;
}) {
  const selectedIds = getSelectedPollOptions(poll);
  const [pendingIds, setPendingIds] = useState(selectedIds);
  const [isEditingVote, setIsEditingVote] = useState(false);
  const [newOption, setNewOption] = useState('');
  const [isAddingOption, setIsAddingOption] = useState(false);
  const [now, setNow] = useState(Date.now);
  const isClosed = poll.closesAt !== undefined && poll.closesAt <= now;
  const hasVoted = selectedIds.length > 0;
  const canVote = !isClosed && (!hasVoted || isEditingVote);
  const shouldShowResults = (hasVoted || isClosed) && (!poll.shouldHideResults || isClosed);
  const totalVotes =
    poll.voterCount ?? poll.options.reduce((total, option) => total + option.votes, 0);
  const votesLabel = totalVotes === 1 ? '1 vote' : `${totalVotes} votes`;
  const isQuiz = Boolean(poll.correctOptionIds?.length);
  const typeLabel = isQuiz ? 'Quiz' : 'Poll';
  const pollLabel = poll.shouldShowVoters ? typeLabel : `Anonymous ${typeLabel.toLowerCase()}`;

  useEffect(() => {
    if (!poll.closesAt || isClosed) {
      return;
    }
    const remaining = Math.min(MAX_TIMEOUT, Math.max(0, poll.closesAt - Date.now()));
    const timer = setTimeout(() => setNow(Date.now()), remaining);
    return () => clearTimeout(timer);
  }, [poll.closesAt, isClosed, now]);

  function chooseOption(id: string) {
    if (!canVote) {
      return;
    }
    if (!poll.canChooseMultiple) {
      onInteract({ type: 'vote', optionIds: [id] });
      setIsEditingVote(false);
      return;
    }
    setPendingIds((current) => {
      return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
    });
  }

  function addOption() {
    const text = newOption.trim();
    if (!text) {
      return;
    }
    onInteract({ type: 'add-option', id: crypto.randomUUID(), text });
    setNewOption('');
    setIsAddingOption(false);
  }

  return (
    <section className={styles.poll} aria-label={poll.question}>
      <strong>{poll.question}</strong>
      <small>
        {pollLabel}
        {isClosed && ' · Closed'}
      </small>
      {poll.description && <p className={styles.pollDescription}>{poll.description}</p>}
      <div className={styles.pollOptions}>
        {poll.options.map((option) => {
          const id = option.id;
          const percentage = totalVotes
            ? Math.round((option.votes / totalVotes) * PERCENTAGE_SCALE)
            : 0;
          const displayedIds = canVote && poll.canChooseMultiple ? pendingIds : selectedIds;
          const isSelected = displayedIds.includes(id);
          const isCorrect = shouldShowResults && poll.correctOptionIds?.includes(id);
          return (
            <button
              type="button"
              key={id}
              aria-pressed={isSelected}
              disabled={!canVote}
              data-correct={isCorrect}
              onClick={() => chooseOption(id)}
            >
              <span className={styles.pollChoice} data-multiple={poll.canChooseMultiple}>
                {(isSelected || isCorrect) && <Check size={14} />}
              </span>
              <span className={styles.pollOptionText}>
                <span>{option.text}</span>
                {poll.shouldShowVoters && shouldShowResults && selectedIds.includes(id) && (
                  <small> · You</small>
                )}
                {shouldShowResults && (
                  <span className={styles.pollBar} style={{ width: `${percentage}%` }} />
                )}
              </span>
              {shouldShowResults && <strong>{percentage}%</strong>}
            </button>
          );
        })}
      </div>
      {canVote && poll.canChooseMultiple && (
        <button
          type="button"
          className={styles.pollAction}
          disabled={!pendingIds.length}
          onClick={() => {
            onInteract({ type: 'vote', optionIds: pendingIds });
            setIsEditingVote(false);
          }}
        >
          Vote
        </button>
      )}
      {hasVoted && !isClosed && poll.canRevote !== false && !isEditingVote && (
        <button
          type="button"
          className={styles.pollAction}
          onClick={() => {
            setPendingIds(selectedIds);
            setIsEditingVote(true);
          }}
        >
          Change vote
        </button>
      )}
      {!isClosed && poll.canAddOptions && poll.options.length < MAX_POLL_OPTIONS && (
        <button
          type="button"
          className={styles.pollAction}
          onClick={() => setIsAddingOption((current) => !current)}
        >
          <Plus size={18} /> Add an Option
        </button>
      )}
      {isAddingOption && !isClosed && (
        <form
          className={styles.appendForm}
          onSubmit={(event) => {
            event.preventDefault();
            addOption();
          }}
        >
          <input
            aria-label="New poll option"
            placeholder="Option"
            value={newOption}
            maxLength={MAX_POLL_OPTION_LENGTH}
            onChange={(event) => setNewOption(event.target.value)}
          />
          <button type="submit" disabled={!newOption.trim()}>
            Add
          </button>
        </form>
      )}
      {shouldShowResults && isQuiz && poll.explanation && (
        <p className={styles.pollDescription}>{poll.explanation}</p>
      )}
      {poll.shouldShowVoters && hasVoted && shouldShowResults && <small>You voted</small>}
      <small>
        {poll.shouldHideResults && !isClosed ? 'Results hidden until the poll closes' : votesLabel}
      </small>
    </section>
  );
}
