import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_POLL_OPTIONS, MAX_POLL_OPTION_LENGTH, type PollMedia } from '@/domain/messages/media';
import type { MessageInteraction } from '@/domain/messages/interaction';
import { getSelectedPollOptions } from '../../../state/pollVoting';
import { Ripple } from '@/components/Ripple';
import { PollOption } from './PollOption';
import { getPollPercentages } from './pollResults';
import { useStructuredMessageAction } from '../../StructuredMessageActions';
import styles from './PollMessage.module.css';

const MAX_TIMEOUT = 2_147_483_647;

/** Render a poll with explicit submission, quiz results, and revoting rules. */
export function PollMessage({
  poll,
  messageId,
  onInteract,
}: {
  poll: PollMedia;
  messageId?: string;
  onInteract: (interaction: MessageInteraction) => void | Promise<boolean>;
}) {
  const selectedIds = getSelectedPollOptions(poll);
  const [pendingIds, setPendingIds] = useState(selectedIds);
  const [isEditingVote, setIsEditingVote] = useState(false);
  const [newOption, setNewOption] = useState('');
  const [isAddingOption, setIsAddingOption] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasPendingAction = useRef(false);
  const isPastDeadline = poll.closesAt !== undefined && poll.closesAt <= now;
  const isClosed = poll.isClosed === true || isPastDeadline;
  const hasVoted = selectedIds.length > 0;
  const canVote =
    !isSubmitting && poll.canVote !== false && !isClosed && (!hasVoted || isEditingVote);
  const canChangeVote = poll.canVote !== false && hasVoted && !isClosed && poll.canRevote !== false;
  const canAddOption = !isClosed && poll.canAddOptions && poll.options.length < MAX_POLL_OPTIONS;
  const shouldShowAnswer = Boolean(poll.correctOptionIds?.length) && (hasVoted || isClosed);
  const currentOptionIds = new Set(poll.options.map((option) => option.id));
  const validPendingIds = pendingIds.filter((id) => currentOptionIds.has(id));
  const canRevealResults = poll.hasVisibleResults ?? (!poll.shouldHideResults || isClosed);
  const shouldShowResults =
    (!isEditingVote || isClosed) && (hasVoted || isClosed) && canRevealResults;
  const totalVotes =
    poll.voterCount ?? poll.options.reduce((total, option) => total + option.votes, 0);
  const isQuiz = poll.isQuiz ?? Boolean(poll.correctOptionIds?.length);
  const memberLabel = totalVotes === 1 ? '1 member' : `${totalVotes} members`;
  const votesLabel = `${memberLabel} ${isQuiz ? 'answered' : 'voted'}`;
  const resultLabel = totalVotes ? votesLabel : 'No votes';
  let footerLabel = (hasVoted && !isEditingVote) || isClosed ? resultLabel : 'Select an option';
  if (isClosed && !canRevealResults) {
    footerLabel = 'Waiting for results';
  } else if (!hasVoted && !isClosed && poll.canVote === false) {
    footerLabel = 'Voting unavailable';
  }
  const percentages = getPollPercentages(poll);
  const typeLabel = isQuiz ? 'Quiz' : 'Poll';
  const pollLabel = poll.shouldShowVoters ? `Public ${typeLabel}` : `Anonymous ${typeLabel}`;

  function changeVote() {
    if (!canChangeVote) {
      return;
    }

    setPendingIds(selectedIds);
    setIsEditingVote(true);
  }

  useStructuredMessageAction({
    messageId,
    action: 'change-vote',
    onAction: changeVote,
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

  async function submitAction(interaction: MessageInteraction) {
    if (hasPendingAction.current) {
      return false;
    }

    // Keep unsubmitted choices editable after a rejected command and prevent concurrent writes.
    hasPendingAction.current = true;
    setIsSubmitting(true);
    try {
      return (await onInteract(interaction)) !== false;
    } finally {
      hasPendingAction.current = false;
      setIsSubmitting(false);
    }
  }

  async function submitVote(optionIds: string[]) {
    if (await submitAction({ type: 'vote', optionIds })) {
      setPendingIds([]);
      setIsEditingVote(false);
    }
  }

  function chooseOption(id: string) {
    if (!canVote) {
      return;
    }
    if (!poll.canChooseMultiple) {
      void submitVote([id]);
      return;
    }

    setPendingIds((current) => {
      return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
    });
  }

  async function addOption() {
    const text = newOption.trim();
    if (!text) {
      return;
    }

    const isAccepted = await submitAction({
      type: 'add-option',
      id: crypto.randomUUID(),
      text,
    });
    if (isAccepted) {
      setNewOption('');
      setIsAddingOption(false);
    }
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
          const displayedIds = canVote && poll.canChooseMultiple ? validPendingIds : selectedIds;

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
              isQuiz={shouldShowAnswer}
              isCorrect={Boolean(poll.correctOptionIds?.includes(option.id))}
              onChoose={() => chooseOption(option.id)}
            />
          );
        })}
      </div>
      {canAddOption && (
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
      {isAddingOption && canAddOption && (
        <form
          className={styles.appendForm}
          onSubmit={(event) => {
            event.preventDefault();
            void addOption();
          }}
        >
          <input
            aria-label="New poll option"
            placeholder="Option"
            value={newOption}
            maxLength={MAX_POLL_OPTION_LENGTH}
            disabled={isSubmitting}
            onChange={(event) => setNewOption(event.target.value)}
          />
          <button
            type="submit"
            className={styles.action}
            disabled={isSubmitting || !newOption.trim()}
          >
            Add
          </button>
        </form>
      )}
      {shouldShowAnswer && poll.explanation && (
        <p className={styles.explanation}>{poll.explanation}</p>
      )}
      <div className={styles.footer}>
        {(canVote || isSubmitting) && poll.canChooseMultiple && validPendingIds.length > 0 ? (
          <button
            type="button"
            className={styles.action}
            disabled={!canVote}
            onClick={() => void submitVote(validPendingIds)}
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
      {(poll.canEdit || poll.canClose || poll.canViewVoters || canChangeVote) && (
        <div className={styles.footer}>
          {canChangeVote && !isEditingVote && poll.canVote !== undefined && (
            <button
              type="button"
              className={styles.action}
              disabled={isSubmitting}
              onClick={changeVote}
            >
              Change vote
            </button>
          )}
          {poll.canEdit && !isClosed && (
            <button
              type="button"
              className={styles.action}
              onClick={() => onInteract({ type: 'edit-poll' })}
            >
              Edit poll
            </button>
          )}
          {poll.canClose && !isClosed && (
            <button
              type="button"
              className={styles.action}
              onClick={() => onInteract({ type: 'close-poll' })}
            >
              Close poll
            </button>
          )}
          {poll.canViewVoters && (
            <button
              type="button"
              className={styles.action}
              onClick={() => onInteract({ type: 'view-voters' })}
            >
              View voters
            </button>
          )}
        </div>
      )}
    </section>
  );
}
