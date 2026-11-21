import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { components } from '@/api/schema';
import { ApiError, isCancelled, type SessionOwner } from '@/features/auth/SessionOwner';
import { RemoteAvatar } from '@/features/media/RemoteAvatar';
import type { ChatOwner } from '../data/ChatOwner';
import { getPollPercentages } from '../messages/content/poll/pollResults';
import { InformationPanel } from '../details/InformationPanel';
import { ConnectedPeerProfile } from './ConnectedPeerProfile';
import styles from './PollVotersPanel.module.css';

type Voter = components['schemas']['PollVoter'];
type PollOption = components['schemas']['PollOptionView'];

interface PollVotersPanelProps {
  owner: Pick<ChatOwner, 'loadPollVoters'>;
  session: SessionOwner;
  messageId: string;
  poll: components['schemas']['PollView'];
  isOpen: boolean;
  onClose: () => void;
}

interface VoterListProps {
  owner: PollVotersPanelProps['owner'];
  session: SessionOwner;
  messageId: string;
  optionId: string;
  onAccessLost: () => void;
  onSelectVoter: (voter: Voter, trigger: HTMLButtonElement) => void;
}

interface OptionResultsProps extends Omit<VoterListProps, 'optionId'> {
  option: PollOption;
  percentage: number;
}

function isAccessFailure(failure: unknown): boolean {
  if (isCancelled(failure)) {
    return true;
  }
  if (!(failure instanceof ApiError)) {
    return false;
  }

  return failure.status === 401 || failure.status === 403 || failure.status === 404;
}

function VoterRow(props: Pick<VoterListProps, 'session' | 'onSelectVoter'> & { voter: Voter }) {
  const { voter, session, onSelectVoter } = props;
  const initials = voter.display_name.slice(0, 2).toUpperCase();
  return (
    <li>
      <button
        type="button"
        className={styles.voter}
        onClick={(event) => onSelectVoter(voter, event.currentTarget)}
      >
        <RemoteAvatar
          session={session}
          owner="user"
          id={voter.user_id}
          fileId={voter.avatar_file_id}
          initials={initials}
          size="small"
        />
        <span dir="auto">{voter.display_name}</span>
      </button>
    </li>
  );
}

function VoterList({
  owner,
  session,
  messageId,
  optionId,
  onAccessLost,
  onSelectVoter,
}: VoterListProps) {
  const [voters, setVoters] = useState<Map<string, Voter>>(new Map());
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [request, setRequest] = useState<{ after?: string }>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // An option owns its requests until the poll version changes or the panel closes.
  // prettier-ignore
  useEffect(() => {
    const controller = new AbortController();

    async function loadPage() {
      try {
        const page = await owner.loadPollVoters({
          messageId,
          optionId,
          after: request.after,
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }

        setVoters((current) => {
          const updated = new Map(current);
          for (const voter of page.voters) {
            updated.set(voter.user_id, voter);
          }
          return updated;
        });
        setNextAfter(page.next_after ?? null);
      } catch (failure) {
        if (controller.signal.aborted) {
          return;
        }
        // The API can observe a visibility change ahead of sync. Drop every option's names.
        if (isAccessFailure(failure)) {
          onAccessLost();
          return;
        }
        setError('Unable to load voters.');
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadPage();
    return () => controller.abort();
  }, [
    owner,
    messageId,
    optionId,
    request,
    onAccessLost
  ]);

  function requestPage() {
    setIsLoading(true);
    setError('');
    const after = error ? request.after : (nextAfter ?? undefined);
    setRequest({ after });
  }

  return (
    <>
      {voters.size > 0 && (
        <ul className={styles.voterList}>
          {Array.from(voters.values(), (voter) => (
            <VoterRow
              key={voter.user_id}
              session={session}
              voter={voter}
              onSelectVoter={onSelectVoter}
            />
          ))}
        </ul>
      )}
      {isLoading && <p role="status">Loading voters…</p>}
      {error && <p role="alert">{error}</p>}
      {!isLoading && (nextAfter || error) && (
        <button className={styles.action} type="button" onClick={requestPage}>
          {error ? 'Retry' : 'Load more'}
        </button>
      )}
    </>
  );
}

function OptionResults({ option, percentage, ...voterList }: OptionResultsProps) {
  const headingId = useId();
  const count = option.votes ?? 0;
  const votesLabel = count === 1 ? '1 vote' : `${count} votes`;

  return (
    <section className={styles.option} aria-labelledby={headingId}>
      <div className={styles.optionHeader}>
        <h4 id={headingId} dir="auto">
          {option.text}
        </h4>
        <strong>{percentage}%</strong>
        <span>{votesLabel}</span>
      </div>
      {count > 0 && <VoterList {...voterList} optionId={option.id} />}
    </section>
  );
}

/** Show results and paginated voters for each option in a public poll. */
export function PollVotersPanel({
  owner,
  session,
  messageId,
  poll,
  isOpen,
  onClose,
}: PollVotersPanelProps) {
  const [isAccessLost, setIsAccessLost] = useState(false);
  const [selection, setSelection] = useState<{ voter: Voter; version: string }>();
  const rowTrigger = useRef<HTMLButtonElement>(null);
  const shouldRestoreRow = useRef(false);
  const selectedVoter = selection?.version === poll.version ? selection.voter : undefined;
  const canShowProfile = !isAccessLost && Boolean(selectedVoter);
  const clearResults = useCallback(() => {
    // A denied page revokes names across every option, including an already-open profile.
    setSelection(undefined);
    setIsAccessLost(true);
  }, []);
  useLayoutEffect(() => {
    if (shouldRestoreRow.current && !canShowProfile && isOpen) {
      shouldRestoreRow.current = false;
      rowTrigger.current?.focus({ preventScroll: true });
    }
  }, [canShowProfile, isOpen]);

  function selectVoter(voter: Voter, trigger: HTMLButtonElement) {
    rowTrigger.current = trigger;
    setSelection({ voter, version: poll.version });
  }

  function returnToResults() {
    shouldRestoreRow.current = true;
    setSelection(undefined);
  }

  const count = poll.voter_count;
  if (poll.is_anonymous || count == null) {
    return null;
  }

  const percentages = getPollPercentages(poll);
  const memberLabel = count === 1 ? '1 member' : `${count} members`;
  const total = `${memberLabel} ${poll.is_quiz ? 'answered' : 'voted'}`;

  return (
    <>
      {/* Keep authorized pages and their requests alive under the selected voter's profile. */}
      <div hidden={canShowProfile} className={styles.panelSlot}>
        <InformationPanel
          title="Poll voters"
          closeLabel="Close poll results"
          isOpen={isOpen && !canShowProfile}
          onClose={onClose}
        >
          {!isAccessLost && <p className={styles.summary}>{total}</p>}
          {isAccessLost ? (
            <p className={styles.unavailable} role="alert">
              Poll results are unavailable.
            </p>
          ) : (
            <div className={styles.results}>
              <h3 dir="auto">{poll.question}</h3>
              {poll.options.map((option, index) => (
                <OptionResults
                  key={`${poll.version}:${option.id}`}
                  option={option}
                  percentage={percentages[index]}
                  owner={owner}
                  session={session}
                  messageId={messageId}
                  onAccessLost={clearResults}
                  onSelectVoter={selectVoter}
                />
              ))}
            </div>
          )}
        </InformationPanel>
      </div>
      {canShowProfile && selectedVoter && (
        <ConnectedPeerProfile
          key={selectedVoter.user_id}
          session={session}
          peerId={selectedVoter.user_id}
          title={selectedVoter.display_name}
          isOpen={isOpen}
          onClose={returnToResults}
        />
      )}
    </>
  );
}
