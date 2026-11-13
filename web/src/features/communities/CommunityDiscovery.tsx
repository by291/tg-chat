import { Search } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { components } from '@/api/schema';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import { requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import { useOperation } from '@/features/accounts/AccountForm';
import { useAccountResource } from '@/features/accounts/useAccountResource';
import { RemoteAvatar } from '@/features/media/RemoteAvatar';
import { communityAudienceLabel, type Conversation } from './communityModels';
import styles from './CommunityDiscovery.module.css';

const SEARCH_DELAY_MS = 250;
const SEARCH_MAX_LENGTH = 100;
const REQUEST_REFRESH_MS = 10_000;
const RESULT_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'group', label: 'Groups' },
  { value: 'channel', label: 'Channels' },
] as const;
type Filter = (typeof RESULT_FILTERS)[number]['value'];
type CommunitySummary = components['schemas']['CommunitySummary'];

interface CommunityDiscoveryProps {
  session: SessionOwner;
  chat: ChatOwner;
  onAdmitted: (conversation: Conversation) => void;
  query?: string;
}

interface DiscoveryCursor {
  search: string;
  kind: Filter;
  after: string;
}

interface CommunityResultProps {
  session: SessionOwner;
  result: {
    id: string;
    title: string;
    kind: string;
    description?: string;
    public_handle?: string | null;
    avatar_file_id?: string | null;
    member_count?: string | null;
  };
  action:
    | { label: string; accessibleName?: string; isDisabled?: boolean; onClick: () => void }
    | { isRequested: true };
}

function matchesJoinedCommunity(conversation: Conversation, filter: Filter, query: string) {
  if (conversation.kind !== 'group' && conversation.kind !== 'channel') {
    return false;
  }
  if (filter !== 'all' && conversation.kind !== filter) {
    return false;
  }
  if (query.startsWith('@')) {
    return Boolean(conversation.public_handle?.toLowerCase().includes(query.slice(1)));
  }
  const title = conversation.title.toLowerCase();
  const publicHandle = conversation.public_handle?.toLowerCase();
  return title.includes(query) || Boolean(publicHandle?.includes(query));
}

function admissionLabel(result: CommunitySummary): string {
  if (result.requires_approval) {
    return 'Request to join';
  }
  return result.kind === 'channel' ? 'Subscribe' : 'Join group';
}

function CommunityResult({ session, result, action }: CommunityResultProps) {
  const audience = communityAudienceLabel({
    kind: result.kind === 'channel' ? 'channel' : 'group',
    memberCount: result.member_count,
  });
  const metadata = [result.public_handle && `@${result.public_handle}`, audience];
  const firstCharacters = Array.from(result.title).slice(0, 2);
  const initials = firstCharacters.join('').toUpperCase();

  return (
    <article aria-label={result.title} className={styles.result}>
      <RemoteAvatar
        session={session}
        owner="conversation"
        id={result.id}
        fileId={result.avatar_file_id}
        initials={initials}
      />
      <div className={styles.resultText}>
        <h3>{result.title}</h3>
        <p>{metadata.filter(Boolean).join(' · ')}</p>
        {result.description && <p className={styles.description}>{result.description}</p>}
      </div>
      {'isRequested' in action ? (
        <span className={styles.requested} role="status">
          Request sent
        </span>
      ) : (
        <button
          type="button"
          className={styles.action}
          aria-label={action.accessibleName}
          disabled={action.isDisabled}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </article>
  );
}

/** Browse public community metadata and open only conversations the account has joined. */
export function CommunityDiscovery({ session, chat, onAdmitted, query }: CommunityDiscoveryProps) {
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const normalizedQuery = (query ?? input).trim().normalize('NFC');
  const [search, setSearch] = useState(normalizedQuery);
  const [cursor, setCursor] = useState<DiscoveryCursor>();
  const [revision, setRevision] = useState(0);
  const operation = useOperation();
  const actionScope = useRef(0);
  const pendingAdmission = useRef<symbol>(undefined);
  const snapshot = useSyncExternalStore(chat.subscribe, chat.getSnapshot);
  const after = cursor?.search === search && cursor.kind === filter ? cursor.after : undefined;
  const kind = filter === 'all' ? undefined : filter;

  useEffect(() => {
    setCursor(undefined);
    const timer = window.setTimeout(() => setSearch(normalizedQuery), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [normalizedQuery]);

  useLayoutEffect(() => {
    return () => {
      pendingAdmission.current = undefined;
    };
  }, [session, chat]);

  useLayoutEffect(() => {
    return () => {
      actionScope.current += 1;
    };
  }, [session, chat, normalizedQuery, filter, after]);

  const load = useCallback(async () => {
    const reply = await session.client.GET('/api/v1/communities', {
      params: { query: { search, kind, after } },
    });
    return requirePayload(reply);
  }, [session, search, kind, after]);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const discovery = useAccountResource(load, String(revision));
  const isCurrentSearch = normalizedQuery === search;
  const joinedIds = new Set(snapshot.conversations.map((conversation) => conversation.id));
  const joined = snapshot.conversations.filter((conversation) => {
    return matchesJoinedCommunity(conversation, filter, normalizedQuery.toLowerCase());
  });
  const results = isCurrentSearch
    ? discovery.value?.items.filter((result) => !joinedIds.has(result.id))
    : undefined;
  const nextPage = isCurrentSearch ? discovery.value?.next : undefined;
  const hasPendingRequests = results?.some((result) => result.has_pending_request);

  useEffect(() => {
    if (!hasPendingRequests) {
      return;
    }
    function refreshPending() {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        refresh();
      }
    }

    // A denied request may leave the conversation directory unchanged.
    const timer = window.setInterval(refreshPending, REQUEST_REFRESH_MS);
    window.addEventListener('focus', refreshPending);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshPending);
    };
  }, [hasPendingRequests, refresh]);

  function requestAdmission(id: string) {
    const communities = chat.communities;
    if (!communities || pendingAdmission.current) {
      return;
    }
    const scope = actionScope.current;
    const admission = Symbol();
    pendingAdmission.current = admission;
    void operation.run({
      operation: async () => {
        try {
          const receipt = await communities.command({
            conversationId: id,
            action: { kind: 'join' },
          });
          // The owner has applied the receipt, but an older search cannot choose the current chat.
          if (pendingAdmission.current === admission) {
            refresh();
          }
          if (scope === actionScope.current && receipt.conversation) {
            onAdmitted(receipt.conversation);
          }
        } catch (error) {
          if (scope === actionScope.current) {
            throw error;
          }
        } finally {
          if (pendingAdmission.current === admission) {
            pendingAdmission.current = undefined;
          }
        }
      },
    });
  }

  return (
    <section className={styles.discovery} aria-label="Public communities">
      <h2>Discover public communities</h2>
      {query === undefined && (
        <label className={styles.search}>
          <Search aria-hidden="true" size={18} />
          <input
            type="search"
            aria-label="Community search"
            placeholder="Search groups and channels"
            maxLength={SEARCH_MAX_LENGTH}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
      )}
      <div className={styles.filters} role="group" aria-label="Community type">
        {RESULT_FILTERS.map(({ value, label }) => (
          <button
            type="button"
            aria-pressed={filter === value}
            key={value}
            onClick={() => {
              setFilter(value);
              setCursor(undefined);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {joined.length > 0 && (
        <section className={styles.results} aria-label="Joined groups and channels">
          <h3>Joined groups and channels</h3>
          {joined.map((result) => (
            <CommunityResult
              key={result.id}
              session={session}
              result={result}
              action={{
                label: 'Open',
                accessibleName: `Open ${result.title}`,
                onClick: () => onAdmitted(result),
              }}
            />
          ))}
        </section>
      )}
      {(discovery.error || operation.error) && (
        <p role="alert">{discovery.error || operation.error}</p>
      )}
      {(!isCurrentSearch || (results === undefined && discovery.isLoading)) && (
        <p role="status">Searching communities…</p>
      )}
      {results?.length === 0 && <p>No other public communities found.</p>}
      {results && results.length > 0 && (
        <section className={styles.results} aria-label="Public results">
          <h3>Public results</h3>
          {results.map((result) => (
            <CommunityResult
              key={result.id}
              session={session}
              result={result}
              action={
                result.has_pending_request
                  ? { isRequested: true }
                  : {
                      label: admissionLabel(result),
                      isDisabled: operation.isPending,
                      onClick: () => requestAdmission(result.id),
                    }
              }
            />
          ))}
        </section>
      )}
      <div className={styles.filters}>
        {after && (
          <button type="button" onClick={() => setCursor(undefined)}>
            First results
          </button>
        )}
        {nextPage && (
          <button
            type="button"
            onClick={() => setCursor({ search, kind: filter, after: nextPage })}
          >
            More results
          </button>
        )}
      </div>
    </section>
  );
}
