import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { components } from '@/api/schema';
import { ApiError, isCancelled, type SessionOwner } from '@/features/auth/SessionOwner';
import { RemoteAvatar } from '@/features/media/RemoteAvatar';
import type { ChatOwner } from '../data/ChatOwner';
import { getPollPercentages } from '../messages/content/poll/pollResults';
import { InformationPanel } from '../details/InformationPanel';
import type { VoterTarget } from './useConversationInformation';
import { useHandheldPanel, type PanelEntry } from './HandheldPanelHistory';
import { ConnectedPeerProfile } from './ConnectedPeerProfile';
import styles from './PollVotersPanel.module.css';

type Voter = components['schemas']['PollVoter'];
type PollOption = components['schemas']['PollOptionView'];

interface PollVotersPanelProps {
  owner: Pick<ChatOwner, 'loadPollVoters'>;
  session: SessionOwner;
  messageId: string;
  poll: components['schemas']['PollView'];
  rememberedVoter?: RefObject<PanelEntry<VoterTarget> | undefined>;
  isOpen: boolean;
  onClose: () => void;
}

interface VoterPage {
  optionId: string;
  after?: string;
  nextAfter?: string | null;
  voters: Voter[];
}

interface VoterRowTarget {
  voter: Voter;
  optionId: string;
  after?: string;
}

interface VoterListProps {
  owner: PollVotersPanelProps['owner'];
  session: SessionOwner;
  messageId: string;
  optionId: string;
  onAccessLost: () => void;
  pages: VoterPage[];
  restoreAfter?: string;
  onLoadPage: (page: VoterPage) => void;
  onSelectVoter: (target: VoterRowTarget, trigger: HTMLButtonElement) => void;
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

function VoterRow(
  props: Pick<VoterListProps, 'session' | 'onSelectVoter'> & {
    target: VoterRowTarget;
  },
) {
  const { target, session, onSelectVoter } = props;
  const { voter } = target;
  const initials = voter.display_name.slice(0, 2).toUpperCase();
  return (
    <li>
      <button
        type="button"
        className={styles.voter}
        data-voter-id={voter.user_id}
        data-voter-option={target.optionId}
        onClick={(event) => onSelectVoter(target, event.currentTarget)}
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

function optionVoters(pages: VoterPage[]) {
  const remaining = new Map(pages.map((page) => [page.after, page]));
  const ordered: VoterPage[] = [];
  let nextAfter: string | undefined;
  let page = remaining.get(undefined);

  // Forward can restore a page ahead of normal pagination. Keep the missing pages reachable.
  while (page) {
    ordered.push(page);
    remaining.delete(page.after);
    nextAfter = page.nextAfter ?? undefined;
    page = nextAfter ? remaining.get(nextAfter) : undefined;
  }

  const rows = new Map<string, VoterRowTarget>();
  for (const admitted of [...ordered, ...remaining.values()]) {
    for (const voter of admitted.voters) {
      rows.set(voter.user_id, {
        voter,
        optionId: admitted.optionId,
        after: admitted.after,
      });
    }
  }
  return { rows, nextAfter };
}

function VoterList({
  owner,
  session,
  messageId,
  optionId,
  onAccessLost,
  onLoadPage,
  onSelectVoter,
  pages,
  restoreAfter,
}: VoterListProps) {
  const { rows, nextAfter } = optionVoters(pages);
  const [request, setRequest] = useState<{ after?: string }>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // prettier-ignore
  useEffect(() => {
    if (restoreAfter && !isLoading && request.after !== restoreAfter) {
      setIsLoading(true);
      setError('');
      setRequest({ after: restoreAfter });
    }
  }, [
    restoreAfter,
    isLoading,
    request.after,
  ]);

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

        onLoadPage({
          optionId,
          after: request.after,
          nextAfter: page.next_after,
          voters: page.voters,
        });
      } catch (failure) {
        if (controller.signal.aborted) {
          return;
        }
        // The API can observe a visibility change ahead of sync. Drop every option's names.
        if (isAccessFailure(failure)) {
          onAccessLost();
          return;
        }
        // A failed restoration has no authorized row. Keep the ordinary Retry action available.
        onLoadPage({
          optionId,
          after: request.after,
          voters: [],
        });
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
    onAccessLost,
    onLoadPage,
  ]);

  function requestPage() {
    setIsLoading(true);
    setError('');
    const after = error ? request.after : (nextAfter ?? undefined);
    setRequest({ after });
  }

  return (
    <>
      {rows.size > 0 && (
        <ul className={styles.voterList}>
          {Array.from(rows.values(), (target) => (
            <VoterRow
              key={target.voter.user_id}
              session={session}
              target={target}
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
  rememberedVoter,
  isOpen,
  onClose,
}: PollVotersPanelProps) {
  const [isAccessLost, setIsAccessLost] = useState(false);
  const [authorized, setAuthorized] = useState<{ version: string; pages: VoterPage[] }>();
  const pages = authorized?.version === poll.version ? authorized.pages : [];

  function authorizedPage(target: VoterTarget) {
    return pages.find((page) => page.optionId === target.optionId && page.after === target.after);
  }
  function isValid(target: VoterTarget) {
    const option = poll.options.find((candidate) => candidate.id === target.optionId);
    if (isAccessLost || target.version !== poll.version || !option?.votes) {
      return false;
    }
    // A remounted panel must reauthorize this exact option and cursor before showing its profile.
    const page = authorizedPage(target);
    return !page || page.voters.some((voter) => voter.user_id === target.id);
  }
  const layer = useHandheldPanel<VoterTarget>({
    remembered: rememberedVoter,
    kind: 'voter',
    isValid,
  });
  const selection = isOpen ? layer.selection : undefined;
  const rowTrigger = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const lastVoter = useRef<VoterTarget>(undefined);
  const selectedPage = selection && authorizedPage(selection);
  const selectedVoter = selectedPage?.voters.find((voter) => voter.user_id === selection?.id);
  const wasProfileOpen = useRef(false);
  const recordPage = useCallback(
    (page: VoterPage) => {
      setAuthorized((previous) => {
        const current = previous?.version === poll.version ? previous.pages : [];
        const otherPages = current.filter(
          (candidate) => candidate.optionId !== page.optionId || candidate.after !== page.after,
        );
        return { version: poll.version, pages: [...otherPages, page] };
      });
    },
    [poll.version],
  );
  const canShowProfile = !isAccessLost && Boolean(selectedVoter);
  const clearResults = useCallback(() => {
    // A denied page revokes names across every option, including an already-open profile.
    setAuthorized(undefined);
    setIsAccessLost(true);
  }, []);
  // prettier-ignore
  useLayoutEffect(() => {
    const didClose = wasProfileOpen.current && !canShowProfile;
    wasProfileOpen.current = canShowProfile;
    if (canShowProfile) {
      lastVoter.current = selection;
    }
    if (didClose && isOpen) {
      // Forward can restore a profile after the original button and its ref were unmounted.
      const rows = resultsRef.current?.querySelectorAll<HTMLButtonElement>('[data-voter-id]') ?? [];
      const restored = Array.from(rows).find((row) => {
        return row.dataset.voterId === lastVoter.current?.id &&
          row.dataset.voterOption === lastVoter.current?.optionId;
      });
      const trigger = rowTrigger.current?.isConnected ? rowTrigger.current : restored;
      trigger?.focus({ preventScroll: true });
    }
  }, [
    canShowProfile,
    isOpen,
    selection,
  ]);

  function selectVoter(target: VoterRowTarget, trigger: HTMLButtonElement) {
    rowTrigger.current = trigger;
    layer.open({
      id: target.voter.user_id,
      optionId: target.optionId,
      after: target.after,
      version: poll.version,
    });
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
      <div ref={resultsRef} hidden={canShowProfile} className={styles.panelSlot}>
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
                  pages={pages.filter((page) => page.optionId === option.id)}
                  restoreAfter={
                    selection?.optionId === option.id && !selectedPage ? selection.after : undefined
                  }
                  onLoadPage={recordPage}
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
          onClose={layer.close}
        />
      )}
    </>
  );
}
