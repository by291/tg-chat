import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useEffect, useRef, useState } from 'react';
import type { components } from '@/api/schema';
import dialogs from '@/components/overlays/dialogs.module.css';
import overlays from '@/components/overlays/overlays.module.css';
import type { ChatOwner } from '../data/ChatOwner';
import styles from './ConnectedChat.module.css';

interface PollVotersDialogProps {
  owner: ChatOwner;
  messageId: string;
  options: components['schemas']['PollOptionView'][];
  onClose: () => void;
}

function VoterList(props: { owner: ChatOwner; messageId: string; optionId?: string }) {
  const { owner, messageId, optionId } = props;
  const [voters, setVoters] = useState<components['schemas']['PollVoter'][]>();
  const [nextAfter, setNextAfter] = useState<string | null>();
  const [request, setRequest] = useState<{ after?: string }>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const loadedVoterIds = useRef(new Set<string>());

  // The filter owns its list and aborts any outstanding page when the dialog closes.
  // prettier-ignore
  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError('');
    void owner.loadPollVoters({
      messageId,
      optionId,
      after: request.after,
      signal: controller.signal,
    }).then((page) => {
      if (controller.signal.aborted) {
        return;
      }

      const newVoters = page.voters.filter((voter) => !loadedVoterIds.current.has(voter.user_id));
      for (const voter of newVoters) {
        loadedVoterIds.current.add(voter.user_id);
      }
      setVoters((current) => [...(current ?? []), ...newVoters]);
      setNextAfter(page.next_after);
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) {
        return;
      }
      // The failure may be a visibility change that reached the API ahead of sync.
      loadedVoterIds.current.clear();
      setVoters(undefined);
      setNextAfter(undefined);
      setError(failure instanceof Error ? failure.message : 'Unable to load poll voters.');
    }).finally(() => {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    });

    return () => controller.abort();
  }, [
    owner,
    messageId,
    optionId,
    request
  ]);

  return (
    <>
      {voters?.length === 0 && <p>No voters.</p>}
      {Boolean(voters?.length) && (
        <ul className={styles.voterList}>
          {voters?.map((voter) => (
            <li key={voter.user_id}>{voter.display_name}</li>
          ))}
        </ul>
      )}
      {isLoading && <p role="status">Loading voters…</p>}
      {error && <p role="alert">{error}</p>}
      {!isLoading && (nextAfter || error) && (
        <button type="button" onClick={() => setRequest({ after: nextAfter ?? undefined })}>
          {error ? 'Retry' : 'Load more'}
        </button>
      )}
    </>
  );
}

/** Show paginated public voters and allow filtering by the selected poll option. */
export function PollVotersDialog({ owner, messageId, options, onClose }: PollVotersDialogProps) {
  const [optionId, setOptionId] = useState('');
  return (
    <Dialog.Root open onOpenChange={({ open }) => !open && onClose()}>
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${dialogs.confirmation} ${styles.confirmation}`}>
            <Dialog.Title>Poll voters</Dialog.Title>
            <label>
              Option
              <select value={optionId} onChange={(event) => setOptionId(event.target.value)}>
                <option value="">All options</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.text}
                  </option>
                ))}
              </select>
            </label>
            <VoterList
              key={optionId}
              owner={owner}
              messageId={messageId}
              optionId={optionId || undefined}
            />
            <button type="button" onClick={onClose}>
              Close
            </button>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
