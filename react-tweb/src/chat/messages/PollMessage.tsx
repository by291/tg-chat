import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MAX_POLL_OPTIONS, MAX_POLL_OPTION_LENGTH, type PollMedia } from '../messageMedia';
import type { MessageInteraction } from '../messageInteraction';
import { getSelectedPollOptions } from '../state/pollVoting';
import { Ripple } from '../../components/Ripple';
import { PollOption } from './PollOption';
import { getPollPercentages } from './pollResults';
import { useStructuredMessageAction } from './StructuredMessageActions';
import styles from './PollMessage.module.css';

const MAX_TIMEOUT = 2_147_483_647;

/** Render a local poll with explicit submission, quiz results, and revoting rules. */
export function PollMessage({
  poll,
  messageId,
  onInteract,
}: {
  poll: PollMedia;
  messageId?: string;
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
  const shouldShowResults =
    (!isEditingVote || isClosed) && (hasVoted || isClosed) && (!poll.shouldHideResults || isClosed);
  const totalVotes =
    poll.voterCount ?? poll.options.reduce((total, option) => total + option.votes, 0);
  const isQuiz = Boolean(poll.correctOptionIds?.length);
  const memberLabel = totalVotes === 1 ? '1 member' : `${totalVotes} members`;
  const votesLabel = `${memberLabel} ${isQuiz ? 'answered' : 'voted'}`;
  const resultLabel = totalVotes ? votesLabel : 'No votes';
  const footerLabel = (hasVoted && !isEditingVote) || isClosed ? resultLabel : 'Select an option';
  const percentages = getPollPercentages(poll);
  const typeLabel = isQuiz ? 'Quiz' : 'Poll';
  const pollLabel = poll.shouldShowVoters ? typeLabel : `Anonymous ${typeLabel}`;

  useStructuredMessageAction({
    messageId,
    action: 'change-vote',
    onAction: () => {
      if (!hasVoted || isClosed || poll.canRevote === false) {
        return;
      }
      setPendingIds(selectedIds);
      setIsEditingVote(true);
    },
  });

  // prettier-ignore
  useEffect(() => {
    if (!poll.closesAt || isClosed) {
      return;
    }
    const remaining = Math.min(MAX_TIMEOUT, Math.max(0, poll.closesAt - Date.now()));
    const timer = setTimeout(() => setNow(Date.now()), remaining);
    return () => clearTimeout(timer);
  }, [
    poll.closesAt,
    isClosed,
    now
  ]);

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
    onInteract({
      type: 'add-option',
      id: crypto.randomUUID(),
      text,
    });
    setNewOption('');
    setIsAddingOption(false);
  }

  return (
    <section className={styles.poll} aria-label={poll.question}>
      {poll.description && <p className={styles.description}>{poll.description}</p>}
      <header className={styles.header}>
        <strong className={styles.title}>{poll.question}</strong>
        <span className={styles.subtitle}>{isClosed ? 'Final Results' : pollLabel}</span>
      </header>
      <div className={styles.options}>
        {poll.options.map((option, index) => {
          const displayedIds = canVote && poll.canChooseMultiple ? pendingIds : selectedIds;
          return (
            <PollOption
              key={option.id}
              text={option.text}
              percentage={percentages[index]}
              votes={option.votes}
              canVote={canVote}
              hasResults={shouldShowResults}
              isSelected={displayedIds.includes(option.id)}
              isMultiple={Boolean(poll.canChooseMultiple)}
              isQuiz={isQuiz}
              isCorrect={Boolean(poll.correctOptionIds?.includes(option.id))}
              onChoose={() => chooseOption(option.id)}
            />
          );
        })}
      </div>
      {canVote && poll.canAddOptions && !isQuiz && poll.options.length < MAX_POLL_OPTIONS && (
        <button
          type="button"
          className={`${styles.option} ${styles.addOption}`}
          onClick={() => setIsAddingOption((current) => !current)}
        >
          <span className={styles.choiceContainer} aria-hidden="true">
            <Plus size={24} />
          </span>
          <span className={styles.optionLabel}>Add an Option</span>
          <Ripple />
        </button>
      )}
      {isAddingOption && canVote && !isQuiz && (
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
          <button type="submit" className={styles.action} disabled={!newOption.trim()}>
            Add
          </button>
        </form>
      )}
      {shouldShowResults && isQuiz && poll.explanation && (
        <p className={styles.explanation}>{poll.explanation}</p>
      )}
      <div className={styles.footer}>
        {canVote && poll.canChooseMultiple && pendingIds.length > 0 ? (
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              onInteract({ type: 'vote', optionIds: pendingIds });
              setIsEditingVote(false);
            }}
          >
            Vote
            <Ripple />
          </button>
        ) : (
          <span className={styles.footerText}>
            {poll.shouldHideResults && !isClosed
              ? 'Results hidden until the poll closes'
              : footerLabel}
          </span>
        )}
      </div>
    </section>
  );
}
