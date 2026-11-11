import { useRef, useState } from 'react';
import { z } from 'zod';
import { ApiError, type SessionOwner } from '@/features/auth/SessionOwner';
import { AccountForm } from './AccountForm';
import styles from './Accounts.module.css';

const OWNERSHIP_CONFLICT = z.object({
  communities: z.array(z.object({ conversation_id: z.string(), title: z.string() })),
});

/** Confirm permanent account deletion and display any ownership prerequisites. */
export function DeleteAccountPanel({ owner }: { owner: SessionOwner }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [communities, setCommunities] = useState<z.infer<typeof OWNERSHIP_CONFLICT>['communities']>(
    [],
  );
  const operation = useRef<string>(undefined);

  async function remove(fields: FormData) {
    const confirmed = fields.get('confirm_shared_messages') === 'on';
    const revision = owner.getSnapshot().revision;
    operation.current ??= crypto.randomUUID();
    setCommunities([]);

    try {
      await owner.client.POST('/api/v1/account/deletion', {
        body: {
          operation_id: operation.current,
          confirm_shared_messages: confirmed,
        },
      });
      if (owner.getSnapshot().revision === revision) {
        owner.invalidate();
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'account_owns_communities') {
        const conflict = OWNERSHIP_CONFLICT.safeParse(failure.context);
        if (conflict.success) {
          setCommunities(conflict.data.communities);
        }
      }
      if (failure instanceof ApiError && failure.code === 'network_unavailable') {
        // A lost response may have followed terminal revocation on the server.
        await owner.refresh().catch(() => undefined);
      }
      throw failure;
    }
  }

  return (
    <section className={styles.card}>
      <h3>Delete account</h3>
      <p>
        Deletion signs out all devices and removes your profile, drafts, and Saved Messages. Shared
        conversations retain their messages and show your author name as Deleted account.
      </p>
      {isConfirming ? (
        <AccountForm submitLabel="Permanently delete account" onSubmit={remove}>
          <label>
            <input name="confirm_shared_messages" type="checkbox" required /> I understand that
            shared messages will remain.
          </label>
          <button type="button" onClick={() => setIsConfirming(false)}>
            Cancel
          </button>
          {communities.length > 0 && (
            <div>
              <p>Transfer or delete these communities first.</p>
              <ul>
                {communities.map((community) => (
                  <li key={community.conversation_id}>{community.title}</li>
                ))}
              </ul>
            </div>
          )}
        </AccountForm>
      ) : (
        <button type="button" onClick={() => setIsConfirming(true)}>
          Continue to deletion
        </button>
      )}
    </section>
  );
}
