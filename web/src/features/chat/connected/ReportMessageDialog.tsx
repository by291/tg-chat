import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { components } from '@/api/schema';
import dialogs from '@/components/overlays/dialogs.module.css';
import overlays from '@/components/overlays/overlays.module.css';
import { showToast } from '@/components/toastStore';
import { isCancelled, requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import styles from './ReportMessageDialog.module.css';

const NOTE_LIMIT = 500;
const REASON_LABELS = {
  spam: 'Spam',
  harassment: 'Harassment',
  harmful_content: 'Harmful content',
  other: 'Other',
} satisfies Record<components['schemas']['ReportReason'], string>;

type Reason = keyof typeof REASON_LABELS;
type ReportInput = components['schemas']['ReportMessage'];

interface ReportMessageDialogProps {
  session: SessionOwner;
  messageIds: string[];
  onClose: () => void;
  onComplete?: (reportedIds: string[]) => void;
}

interface PendingReport {
  messageId: string;
  messageNumber: number;
  request: ReportInput;
}

interface ReportFailure {
  report: PendingReport;
  message: string;
}

interface ReportSubmission {
  session: SessionOwner;
  pendingReports: PendingReport[];
  revision: number;
  signal: AbortSignal;
}

async function sendReports({ session, pendingReports, revision, signal }: ReportSubmission) {
  const failures: ReportFailure[] = [];

  for (const report of pendingReports) {
    try {
      const response = await session.client.POST('/api/v1/messages/{message_id}/reports', {
        params: { path: { message_id: report.messageId } },
        body: report.request,
        signal,
      });
      requirePayload(response);
    } catch (failure) {
      if (isCancelled(failure)) {
        return;
      }

      const message = failure instanceof Error ? failure.message : 'The report could not be sent.';
      failures.push({ report, message });
    }

    // A transport may return after the dialog closes or authentication changes.
    if (signal.aborted || session.getSnapshot().revision !== revision) {
      return;
    }
  }

  return failures;
}

function ReportFailures({ failures, total }: { failures: ReportFailure[]; total: number }) {
  if (total === 1) {
    return (
      <p className={styles.failure} role="alert">
        {failures[0].message}
      </p>
    );
  }

  return (
    <div className={styles.failure} role="alert">
      <p>
        {total - failures.length} of {total} reports sent.
      </p>
      <ul>
        {failures.map(({ report, message }) => (
          <li key={report.messageId}>
            Message {report.messageNumber}. {message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Collect the reason and note, then report the selected messages through the current session. */
export function ReportMessageDialog({
  session,
  messageIds,
  onClose,
  onComplete,
}: ReportMessageDialogProps) {
  const [selectedMessageIds] = useState(() => [...new Set(messageIds)]);
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState('');
  const [failures, setFailures] = useState<ReportFailure[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const submission = useRef<AbortController>(null);
  const detailHeading = useRef<HTMLDivElement>(null);
  const lastReason = useRef<Reason>(undefined);
  const reasonButtons = useRef<Partial<Record<Reason, HTMLButtonElement | null>>>({});

  const total = selectedMessageIds.length;
  const hasMultipleMessages = total > 1;
  const hasFailures = failures.length > 0;
  const submitLabel = hasFailures ? 'Retry report' : 'Submit report';
  // A lost response can hide a recorded case, so each retry sends the same report details.
  const canEdit = !isBusy && !hasFailures;

  useLayoutEffect(() => () => submission.current?.abort(), []);

  useEffect(() => {
    if (reason) {
      lastReason.current = reason;
      detailHeading.current?.focus();
      return;
    }

    if (lastReason.current) {
      reasonButtons.current[lastReason.current]?.focus();
    }
  }, [reason]);

  function close() {
    if (!submission.current) {
      onClose();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submission.current || !reason || total === 0) {
      return;
    }

    const normalizedNote = note.trim();
    const pendingReports = hasFailures
      ? failures.map(({ report }) => report)
      : selectedMessageIds.map((messageId, index) => ({
          messageId,
          messageNumber: index + 1,
          request: {
            operation_id: crypto.randomUUID(),
            reason,
            note: normalizedNote,
          },
        }));

    const controller = new AbortController();
    const { signal } = controller;
    submission.current = controller;
    setIsBusy(true);

    try {
      const revision = session.getSnapshot().revision;
      const currentFailures = await sendReports({
        session,
        pendingReports,
        revision,
        signal,
      });
      const isCurrentSession = session.getSnapshot().revision === revision;
      if (!currentFailures || signal.aborted || !isCurrentSession) {
        return;
      }
      if (currentFailures.length > 0) {
        setFailures(currentFailures);
        return;
      }

      showToast(hasMultipleMessages ? `${total} reports submitted` : 'Report submitted', {
        isPassive: true,
      });
      onComplete?.(selectedMessageIds);
      onClose();
    } finally {
      submission.current = null;
      if (!signal.aborted) {
        setIsBusy(false);
      }
    }
  }

  return (
    <Dialog.Root
      open
      closeOnEscape={!isBusy}
      closeOnInteractOutside={!isBusy}
      onOpenChange={({ open }) => {
        if (!open) {
          close();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${styles.dialog} ${dialogs.confirmation}`}>
            <Dialog.Title className={styles.title}>
              {hasMultipleMessages ? 'Report messages' : 'Report message'}
            </Dialog.Title>
            {reason ? (
              <form onSubmit={(event) => void submit(event)}>
                <Dialog.Description
                  className={styles.selectedReason}
                  ref={detailHeading}
                  tabIndex={-1}
                >
                  {REASON_LABELS[reason]}
                </Dialog.Description>
                <label className={styles.note}>
                  Note (optional)
                  <textarea
                    value={note}
                    maxLength={NOTE_LIMIT}
                    readOnly={!canEdit}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
                <p className={styles.retention}>
                  The reported content and its original attachments are kept only in the case for 90
                  days by default, even if the original message is deleted.
                </p>
                {hasFailures && <ReportFailures failures={failures} total={total} />}
                <div className={styles.actions}>
                  <button
                    className={`${overlays.textButton} ${styles.back}`}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setReason(null)}
                  >
                    Back
                  </button>
                  <button
                    className={overlays.textButton}
                    type="button"
                    disabled={isBusy}
                    onClick={close}
                  >
                    Cancel
                  </button>
                  <button className={overlays.textButton} type="submit" disabled={isBusy}>
                    {isBusy ? 'Submitting…' : submitLabel}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <Dialog.Description className={styles.description}>
                  Choose a reason for your report.
                </Dialog.Description>
                <ul className={styles.reasons}>
                  {(Object.entries(REASON_LABELS) as [Reason, string][]).map(([value, label]) => (
                    <li key={value}>
                      <button
                        className={styles.reason}
                        type="button"
                        ref={(button) => {
                          reasonButtons.current[value] = button;
                        }}
                        onClick={() => setReason(value)}
                      >
                        {label}
                        <ChevronRight aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className={styles.actions}>
                  <button className={overlays.textButton} type="button" onClick={close}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
