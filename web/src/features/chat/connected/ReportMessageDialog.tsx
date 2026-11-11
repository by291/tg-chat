import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useRef, useState, type FormEvent } from 'react';
import type { components } from '@/api/schema';
import { requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import dialogs from '@/components/overlays/dialogs.module.css';
import overlays from '@/components/overlays/overlays.module.css';
import styles from './ConnectedChat.module.css';

type Reason = components['schemas']['ReportReason'];
type ReportInput = components['schemas']['ReportMessage'];

const NOTE_LIMIT = 500;

interface ReportMessageDialogProps {
  session: SessionOwner;
  messageId: string;
  onClose: () => void;
}

/** Explain case retention and submit one report through the current browser session. */
export function ReportMessageDialog({ session, messageId, onClose }: ReportMessageDialogProps) {
  const [reason, setReason] = useState<Reason>('spam');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isReported, setIsReported] = useState(false);
  const lastRequest = useRef<ReportInput>(undefined);
  const isSubmitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting.current) {
      return;
    }

    const normalizedNote = note.trim();
    const prior = lastRequest.current;
    const isSameRequest = prior?.reason === reason && prior.note === normalizedNote;
    // A lost response can hide a committed case, so an unchanged retry reuses the operation.
    const request: ReportInput = {
      operation_id: isSameRequest ? prior.operation_id : crypto.randomUUID(),
      reason,
      note: normalizedNote,
    };
    lastRequest.current = request;
    isSubmitting.current = true;
    setIsBusy(true);
    setError('');

    try {
      const response = await session.client.POST('/api/v1/messages/{message_id}/reports', {
        params: { path: { message_id: messageId } },
        body: request,
      });
      requirePayload(response);
      setIsReported(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The report could not be sent.');
    } finally {
      isSubmitting.current = false;
      setIsBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={({ open }) => !open && !isBusy && onClose()}>
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${styles.confirmation} ${dialogs.confirmation}`}>
            <Dialog.Title>{isReported ? 'Report submitted' : 'Report message'}</Dialog.Title>
            <Dialog.Description>
              The reported message and its original attachments are kept in the case for 90 days by
              default, even if the message is deleted.
            </Dialog.Description>
            {isReported ? (
              <button type="button" onClick={onClose}>
                Done
              </button>
            ) : (
              <form onSubmit={(event) => void submit(event)}>
                <label>
                  Reason
                  <select
                    aria-label="Report reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value as Reason)}
                  >
                    <option value="spam">Spam</option>
                    <option value="harassment">Harassment</option>
                    <option value="harmful_content">Harmful content</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label>
                  Note (optional)
                  <textarea
                    value={note}
                    maxLength={NOTE_LIMIT}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
                {error && <p role="alert">{error}</p>}
                <div className={styles.actions}>
                  <button type="button" disabled={isBusy} onClick={onClose}>
                    Cancel
                  </button>
                  <button type="submit" disabled={isBusy}>
                    Submit report
                  </button>
                </div>
              </form>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
