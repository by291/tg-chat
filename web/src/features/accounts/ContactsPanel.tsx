import { useCallback, useState } from 'react';
import type { components } from '@/api/schema';
import { SessionOwner, requirePayload } from '../auth/SessionOwner';
import { AccountForm, Field, textField, useOperation } from './AccountForm';
import { useAccountResource } from './useAccountResource';
import styles from './Accounts.module.css';

type DirectoryPage = components['schemas']['DirectoryPage'];
type DirectoryScope = 'contacts' | 'blocks' | 'search';

/** Browse account-owned relationships and search only bounded public directory fields. */
export function ContactsPanel({ owner }: { owner: SessionOwner }) {
  const [scope, setScope] = useState<DirectoryScope>('contacts');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string>();
  const action = useOperation();
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

  function changeScope(next: DirectoryScope) {
    setScope(next);
    setSearch('');
    setCursor(undefined);
  }

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

  async function submitSearch(fields: FormData) {
    setSearch(textField(fields, 'search').trim());
    setCursor(undefined);
  }

  return (
    <div className={styles.panel}>
      <section className={styles.card}>
        <h2>Contacts & blocks</h2>
        <div className={styles.rowActions} aria-label="Directory views">
          <button
            type="button"
            className={styles.textButton}
            aria-pressed={scope === 'contacts'}
            onClick={() => changeScope('contacts')}
          >
            My contacts
          </button>
          <button
            type="button"
            className={styles.textButton}
            aria-pressed={scope === 'blocks'}
            onClick={() => changeScope('blocks')}
          >
            Blocked users
          </button>
          <button
            type="button"
            className={styles.textButton}
            aria-pressed={scope === 'search'}
            onClick={() => changeScope('search')}
          >
            Find people
          </button>
        </div>
        <AccountForm key={scope} submitLabel="Search" onSubmit={submitSearch}>
          <Field
            label="Username or display name"
            name="search"
            defaultValue={search}
            minLength={scope === 'search' ? 2 : undefined}
            maxLength={80}
            required={scope === 'search'}
          />
        </AccountForm>
        <p className={styles.hint}>
          Contacts are private and one-way. People you save do not see your contact list.
        </p>
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
        {!directory.isLoading && !directory.value?.users.length && (
          <p className={styles.empty}>
            No people to show. Search by username or display name to find someone.
          </p>
        )}
        <ul className={styles.list}>
          {directory.value?.users.map((person) => (
            <li key={person.id} className={styles.listRow}>
              <div>
                <strong>{person.display_name}</strong>
                <p>@{person.username}</p>
                {person.biography && <p className={styles.hint}>{person.biography}</p>}
              </div>
              <div className={styles.rowActions}>
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
          {cursor && (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => setCursor(undefined)}
            >
              First page
            </button>
          )}
          {directory.value?.next_cursor && (
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
