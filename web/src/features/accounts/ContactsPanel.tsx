import { Search } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ActionConfirmation, type Confirmation } from '../chat/connected/ActionConfirmation';
import type { components } from '@/api/schema';
import { SessionOwner, requirePayload } from '../auth/SessionOwner';
import { useOperation } from './AccountForm';
import {
  ContactRow,
  type DirectoryPerson,
  type DirectoryScope,
  type RelationshipAction,
} from './ContactRow';
import { useAccountResource } from './useAccountResource';
import styles from './Accounts.module.css';

const SEARCH_DELAY_MS = 300;
const DIRECTORY_PAGE_SIZE = 20;
const MINIMUM_SEARCH_LENGTH = 2;

const RELATIONSHIPS = {
  add: {
    kind: 'contacts',
    shouldInclude: true,
    result: 'added to contacts',
  },
  remove: {
    kind: 'contacts',
    shouldInclude: false,
    result: 'removed from contacts',
  },
  block: {
    kind: 'blocks',
    shouldInclude: true,
    result: 'blocked',
  },
  unblock: {
    kind: 'blocks',
    shouldInclude: false,
    result: 'unblocked',
  },
} as const;

type DirectoryPage = components['schemas']['DirectoryPage'];

/** Browse account-owned relationships and search only bounded public directory fields. */
export function ContactsPanel({
  owner,
  scope,
  onStartChat,
}: {
  owner: SessionOwner;
  scope: DirectoryScope;
  onStartChat?: (person: DirectoryPerson) => void;
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string>();
  const action = useOperation();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const term = query.trim();
  useEffect(() => {
    if (term === search) {
      return;
    }

    // Wait for typing to settle before spending the public directory's admission budget.
    const timer = window.setTimeout(() => {
      setSearch(term);
      setCursor(undefined);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [term, search]);

  const { relationships } = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  // Writes from cards or another directory invalidate the same query and cursor.
  const membership = scope === 'search' ? relationships : relationships?.[scope];
  const load = useCallback(
    async (): Promise<DirectoryPage> => {
      if (scope === 'search' && search.length < MINIMUM_SEARCH_LENGTH) {
        return { users: [], next_cursor: null };
      }
      const parameters = {
        params: {
          query: {
            search: search || undefined,
            cursor,
            limit: DIRECTORY_PAGE_SIZE,
          },
        },
      };
      if (scope === 'search') {
        return requirePayload(await owner.client.GET('/api/v1/users', parameters));
      }
      if (scope === 'blocks') {
        return requirePayload(await owner.client.GET('/api/v1/blocks', parameters));
      }

      return requirePayload(await owner.client.GET('/api/v1/contacts', parameters));
    },
    // prettier-ignore
    [
      owner,
      scope,
      search,
      cursor,
      membership,
    ],
  );
  const directory = useAccountResource(load);

  function selectAction(kind: RelationshipAction, person: DirectoryPerson) {
    const relationship = RELATIONSHIPS[kind];
    const name = person.display_name;

    function commit() {
      return action.run({
        operation: async () => {
          await owner.setRelationship({
            kind: relationship.kind,
            id: person.id,
            shouldInclude: relationship.shouldInclude,
          });
        },
        successMessage: `${name} ${relationship.result}.`,
      });
    }

    if (kind === 'remove' || kind === 'block') {
      const isRemoval = kind === 'remove';
      const title = isRemoval ? `Remove ${name} from contacts?` : `Block ${name}?`;
      const username = `@${person.username}`;
      const description = isRemoval
        ? `Remove ${username} from your contact list.`
        : `Add ${username} to your blocked users.`;
      setConfirmation({
        title,
        description,
        choices: [{ label: isRemoval ? 'Remove contact' : 'Block', action: commit }],
      });
      return;
    }

    void commit();
  }

  const isSearching = term !== search;
  const canShowResults = !isSearching && !directory.isLoading;
  let emptyMessage = 'No contacts found.';
  if (scope === 'blocks') {
    emptyMessage = 'No blocked users.';
  } else if (scope === 'search') {
    emptyMessage =
      search.length < MINIMUM_SEARCH_LENGTH ? 'Enter at least two characters.' : 'No people found.';
  }

  return (
    <div className={styles.panel}>
      <section aria-label={scope === 'blocks' ? 'Blocked accounts' : 'People'}>
        <label className={styles.contactSearch}>
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label={scope === 'search' ? 'Username or display name' : 'Search contacts'}
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={80}
          />
        </label>
        {directory.isLoading && <p role="status">Loading people…</p>}
        {(directory.error || action.error) && (
          <p role="alert" className={styles.error}>
            {directory.error || action.error}
          </p>
        )}
        {action.notice && (
          <p role="status" className={styles.notice}>
            {action.notice}
          </p>
        )}
        {canShowResults && !directory.value?.users.length && (
          <p className={styles.empty}>{emptyMessage}</p>
        )}
        <ul className={styles.list}>
          {canShowResults &&
            directory.value?.users.map((person) => (
              <ContactRow
                key={person.id}
                owner={owner}
                person={person}
                scope={scope}
                isPending={action.isPending}
                onAction={selectAction}
                onStartChat={onStartChat}
              />
            ))}
        </ul>
        <div className={styles.rowActions}>
          {canShowResults && cursor && (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => setCursor(undefined)}
            >
              First page
            </button>
          )}
          {canShowResults && directory.value?.next_cursor && (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => setCursor(directory.value?.next_cursor ?? undefined)}
            >
              Next page
            </button>
          )}
        </div>
      </section>
      <ActionConfirmation
        confirmation={confirmation}
        isBusy={action.isPending}
        onCancel={() => setConfirmation(undefined)}
        onChoose={(commit) => {
          setConfirmation(undefined);
          void commit();
        }}
      />
    </div>
  );
}
