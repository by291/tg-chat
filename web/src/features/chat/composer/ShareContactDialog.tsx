import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useState, type FormEvent } from 'react';
import type { components } from '@/api/schema';
import overlays from '@/components/overlays/overlays.module.css';
import { requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import type { MessageBodyInput } from '../data/messageModels';
import styles from './ShareContactDialog.module.css';

const MAX_NAME_LENGTH = 80;
const MAX_PHONE_LENGTH = 40;
const MAX_QUERY_LENGTH = 80;
const MIN_QUERY_LENGTH = 2;

type ContactBody = Extract<MessageBodyInput, { kind: 'contact' }>;
type PublicProfile = components['schemas']['PublicProfile'];

interface ShareContactDialogProps {
  session: SessionOwner;
  onClose: () => void;
  onSubmit: (body: ContactBody) => Promise<boolean>;
}

/** Compose a contact snapshot with an optional account selected from the public directory. */
export function ShareContactDialog({ session, onClose, onSubmit }: ShareContactDialogProps) {
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [account, setAccount] = useState<PublicProfile>();
  const [matches, setMatches] = useState<PublicProfile[]>();
  const [isSearching, setIsSearching] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSearching(true);
    setError('');
    setMatches(undefined);

    try {
      const response = await session.client.GET('/api/v1/users', {
        params: {
          query: {
            search: query.trim(),
            linkable_only: true,
          },
        },
      });
      setMatches(requirePayload(response).users);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not search for accounts.');
    } finally {
      setIsSearching(false);
    }
  }

  function choose(profile: PublicProfile) {
    setAccount(profile);
    setMatches(undefined);
    setName(profile.display_name);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSending(true);

    const isQueued = await onSubmit({
      kind: 'contact',
      display_name: name.trim(),
      account_id: account?.id,
      phone: phone.trim() || undefined,
    });
    if (isQueued) {
      onClose();
      return;
    }

    setIsSending(false);
    setError('Could not queue the contact. Try again.');
  }

  return (
    <Dialog.Root
      open
      onOpenChange={({ open }) => {
        if (!open && !isSending) {
          onClose();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop className={overlays.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${overlays.dialog} ${styles.dialog}`}>
            <Dialog.Title>Share contact</Dialog.Title>
            <Dialog.Description>
              Enter the name and any phone number you want to share.
            </Dialog.Description>
            <form className={styles.form} onSubmit={(event) => void search(event)}>
              <label className={styles.field}>
                Find an account to link (optional)
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  maxLength={MAX_QUERY_LENGTH}
                  disabled={isSearching || isSending}
                />
              </label>
              <button
                type="submit"
                className={overlays.textButton}
                disabled={query.trim().length < MIN_QUERY_LENGTH || isSearching || isSending}
              >
                Search
              </button>
            </form>
            {matches?.length === 0 && <p role="status">No matching accounts.</p>}
            {matches && matches.length > 0 && (
              <ul className={styles.matches} aria-label="Matching accounts">
                {matches.map((profile) => (
                  <li key={profile.id}>
                    <button
                      type="button"
                      className={overlays.textButton}
                      disabled={isSending}
                      onClick={() => choose(profile)}
                    >
                      {profile.display_name} (@{profile.username})
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {account && (
              <div className={styles.linked}>
                Linked to @{account.username}
                <button
                  type="button"
                  className={overlays.textButton}
                  disabled={isSending}
                  onClick={() => setAccount(undefined)}
                >
                  Remove link
                </button>
              </div>
            )}
            {error && <p role="alert">{error}</p>}
            <form className={styles.form} onSubmit={(event) => void send(event)}>
              <label className={styles.field}>
                Name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={MAX_NAME_LENGTH}
                  required
                  disabled={isSending}
                />
              </label>
              <label className={styles.field}>
                Phone (optional)
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  maxLength={MAX_PHONE_LENGTH}
                  disabled={isSending}
                />
              </label>
              <div className={overlays.dialogActions}>
                <Dialog.CloseTrigger className={overlays.textButton} disabled={isSending}>
                  Cancel
                </Dialog.CloseTrigger>
                <button
                  type="submit"
                  className={overlays.textButton}
                  disabled={!name.trim() || isSending}
                >
                  Send contact
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
