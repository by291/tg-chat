import { Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import type { components } from '@/api/schema';
import { SessionOwner, requirePayload } from '../auth/SessionOwner';
import { useOperation } from './AccountForm';
import { useAccountResource } from './useAccountResource';
import styles from './Accounts.module.css';

type DirectoryPage = components['schemas']['DirectoryPage'];
const SEARCH_DELAY_MS = 300;

type DirectoryScope = 'contacts' | 'blocks' | 'search';

/** Browse account-owned relationships and search only bounded public directory fields. */
export function ContactsPanel({
  owner,
  scope,
  onStartChat,
}: {
  owner: SessionOwner;
  scope: DirectoryScope;
  onStartChat?: (person: components['schemas']['PublicProfile']) => void;
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string>();
  const action = useOperation();
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

  const load = useCallback(
    async (): Promise<DirectoryPage> => {
      if (scope === 'search' && search.length < 2) {
        return { users: [], next_cursor: null };
      }
      const parameters = {
        params: {
          query: {
            search: search || undefined,
            cursor,
            limit: 20,
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
    ],
  );
  const directory = useAccountResource(load);

  function changeRelationship(options: {
    targetId: string;
    kind: 'contact' | 'block';
    operation: 'add' | 'remove';
  }) {
    void action.run({
      operation: async () => {
        const path = options.kind === 'contact' ? '/api/v1/contacts' : '/api/v1/blocks';
        const parameters = { body: { target_id: options.targetId } };
        if (options.operation === 'add') {
          await owner.client.PUT(path, parameters);
        } else {
          await owner.client.DELETE(path, parameters);
        }
        directory.reload();
      },
      successMessage: 'Relationship saved.',
    });
  }

  const isSearching = term !== search;
  const canShowResults = !isSearching && !directory.isLoading;
  let emptyMessage = 'No contacts found.';
  if (scope === 'blocks') {
    emptyMessage = 'No blocked users.';
  } else if (scope === 'search') {
    emptyMessage = search.length < 2 ? 'Enter at least two characters.' : 'No people found.';
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
              <li key={person.id} className={styles.listRow}>
                <div className={styles.contactIdentity}>
                  <Avatar initials={person.display_name.slice(0, 2).toUpperCase()} />
                  <div>
                    <strong>{person.display_name}</strong>
                    <p>@{person.username}</p>
                    {person.biography && <p className={styles.hint}>{person.biography}</p>}
                  </div>
                </div>
                <div className={styles.rowActions}>
                  {onStartChat && scope !== 'blocks' && (
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => onStartChat(person)}
                    >
                      Message
                    </button>
                  )}
                  {scope === 'search' && (
                    <button
                      type="button"
                      className={styles.textButton}
                      disabled={action.isPending}
                      onClick={() =>
                        changeRelationship({
                          targetId: person.id,
                          kind: 'contact',
                          operation: 'add',
                        })
                      }
                    >
                      Add contact
                    </button>
                  )}
                  {scope === 'contacts' && (
                    <button
                      type="button"
                      className={styles.textButton}
                      disabled={action.isPending}
                      onClick={() =>
                        changeRelationship({
                          targetId: person.id,
                          kind: 'contact',
                          operation: 'remove',
                        })
                      }
                    >
                      Remove contact
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.textButton}
                    disabled={action.isPending}
                    onClick={() =>
                      changeRelationship({
                        targetId: person.id,
                        kind: 'block',
                        operation: scope === 'blocks' ? 'remove' : 'add',
                      })
                    }
                  >
                    {scope === 'blocks' ? 'Unblock' : 'Block'}
                  </button>
                </div>
              </li>
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
    </div>
  );
}
