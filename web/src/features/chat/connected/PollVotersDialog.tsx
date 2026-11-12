import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import type { components } from '@/api/schema';
import { Avatar } from '@/components/Avatar';
import { IconButton } from '@/components/IconButton';
import dialogs from '@/components/overlays/dialogs.module.css';
import overlays from '@/components/overlays/overlays.module.css';
import { ApiError, isCancelled, type SessionOwner } from '@/features/auth/SessionOwner';
import { RemoteAvatar } from '@/features/media/RemoteAvatar';
import type { ChatOwner } from '../data/ChatOwner';
import { getPollPercentages } from '../messages/content/poll/pollResults';
import styles from './PollVotersDialog.module.css';

type Voter = components['schemas']['PollVoter'];
type PollOption = components['schemas']['PollOptionView'];

interface PollVotersDialogProps {
  owner: Pick<ChatOwner, 'loadPollVoters'>;
  session?: SessionOwner;
  messageId: string;
  poll: components['schemas']['PollView'];
  onClose: () => void;
}

interface VoterListProps {
  owner: PollVotersDialogProps['owner'];
  session?: SessionOwner;
  messageId: string;
  optionId: string;
  onAccessLost: () => void;
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

function VoterRow({ voter, session }: { voter: Voter; session?: SessionOwner }) {
  const initials = voter.display_name.slice(0, 2).toUpperCase();
  return (
    <li className={styles.voter}>
      {session && voter.avatar_file_id ? (
        <RemoteAvatar
          session={session}
          owner="user"
          id={voter.user_id}
          fileId={voter.avatar_file_id}
          initials={initials}
          size="small"
        />
      ) : (
        <Avatar initials={initials} size="small" />
      )}
      <span dir="auto">{voter.display_name}</span>
    </li>
  );
}

function VoterList({ owner, session, messageId, optionId, onAccessLost }: VoterListProps) {
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
            <VoterRow key={voter.user_id} session={session} voter={voter} />
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
export function PollVotersDialog({
  owner,
  session,
  messageId,
  poll,
  onClose,
}: PollVotersDialogProps) {
  const [isAccessLost, setIsAccessLost] = useState(false);
  const clearResults = useCallback(() => setIsAccessLost(true), []);
  const count = poll.voter_count;
  if (poll.is_anonymous || count == null) {
    return null;
  }

  const percentages = getPollPercentages(poll);
  const memberLabel = count === 1 ? '1 member' : `${count} members`;
  const total = `${memberLabel} ${poll.is_quiz ? 'answered' : 'voted'}`;

  return (
    <Dialog.Root
      open
      onOpenChange={({ open }) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={`${overlays.dialogPositioner} ${styles.positioner}`}>
          <Dialog.Content className={styles.panel}>
            <header className={styles.header}>
              <div>
                <Dialog.Title>Poll voters</Dialog.Title>
                {!isAccessLost && <Dialog.Description>{total}</Dialog.Description>}
              </div>
              <Dialog.CloseTrigger asChild>
                <IconButton label="Close poll results">
                  <X />
                </IconButton>
              </Dialog.CloseTrigger>
            </header>
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
                  />
                ))}
              </div>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
