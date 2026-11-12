import { useEffect, useId, useRef, useState } from 'react';
import type { components } from '@/api/schema';
import accountStyles from '@/features/accounts/Accounts.module.css';
import { PasswordConfirmation } from '@/features/accounts/SecurityPanel';
import {
  ApiError,
  isCancelled,
  requirePayload,
  type SessionOwner,
} from '@/features/auth/SessionOwner';
import { CaseActions } from './CaseActions';
import { CaseEvidence } from './CaseEvidence';
import styles from './OperatorWorkspace.module.css';

const INITIAL_READ = { kind: 'queue' } as const;

type CasePage = components['schemas']['CasePage'];
type CaseDetail = components['schemas']['CaseDetail'];
type CaseSummary = components['schemas']['CaseSummary'];
type OperatorAction = components['schemas']['OperatorAction'];

type CaseRead = { kind: 'queue'; after?: string } | { kind: 'detail'; caseId: string };

function reportReason(reason: string): string {
  return reason.replaceAll('_', ' ');
}

function reportStatus(report: CaseSummary): string {
  return report.resolved_at ? 'Resolved' : 'Open';
}

function actionNotice(action: OperatorAction): string {
  switch (action.kind) {
    case 'resolve_case':
      return 'Case resolved.';
    case 'extend_evidence':
      return 'Evidence retention extended.';
    case 'set_suspension':
      return action.is_suspended ? 'Reported account suspended.' : 'Reported account restored.';
    case 'set_quarantine':
      return action.is_quarantined ? 'Conversation quarantined.' : 'Conversation restored.';
    default:
      return 'Action completed.';
  }
}

function ReportRow({
  report,
  onOpen,
  isLoading,
}: {
  report: CaseSummary;
  onOpen: () => void;
  isLoading: boolean;
}) {
  const labelId = useId();
  const statusId = useId();
  const dateId = useId();
  const date = new Date(report.created_at);
  return (
    <li>
      <button
        type="button"
        className={styles.reportRow}
        aria-labelledby={labelId}
        aria-describedby={`${statusId} ${dateId}`}
        disabled={isLoading}
        onClick={onOpen}
      >
        <strong id={labelId}>Review {reportReason(report.reason)} report</strong>
        <span id={statusId}>{reportStatus(report)}</span>
        <time id={dateId} dateTime={report.created_at}>
          {date.toLocaleString()}
        </time>
      </button>
    </li>
  );
}

/** Load the operator report queue and review one retained case at a time. */
export function ReportCases({ owner }: { owner: SessionOwner }) {
  const [page, setPage] = useState<CasePage>();
  const [detail, setDetail] = useState<CaseDetail>();
  const [openedId, setOpenedId] = useState<string>();
  const [read, setRead] = useState<CaseRead | undefined>(INITIAL_READ);
  const [passwordRead, setPasswordRead] = useState<CaseRead>();
  const [isReviewLocked, setIsReviewLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const shouldFocusHeading = useRef(false);
  const selectedId = useRef<string>(undefined);
  const changedCases = useRef(new Set<string>());
  const shouldRetryAction = useRef(false);

  useEffect(() => {
    if (shouldFocusHeading.current) {
      heading.current?.focus();
      shouldFocusHeading.current = false;
    }
  }, [openedId]);

  useEffect(() => {
    if (!read) {
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;

    async function load(request: CaseRead) {
      try {
        if (request.kind === 'queue') {
          const response = await owner.client.GET('/api/v1/operator/cases', {
            params: { query: { after: request.after } },
            signal,
          });
          const next = requirePayload(response);
          if (signal.aborted) {
            return;
          }
          setPage((current) => appendPage({ current, next, after: request.after }));
          if (!request.after) {
            changedCases.current.clear();
          }
          return;
        }

        const response = await owner.client.GET('/api/v1/operator/cases/{case_id}', {
          params: { path: { case_id: request.caseId } },
          signal,
        });
        const next = requirePayload(response);
        if (signal.aborted) {
          return;
        }
        setDetail(next);
        setIsReviewLocked(false);
        setPage((current) => updateSummary(current, next.case));
        changedCases.current.delete(next.case.id);
        if (shouldRetryAction.current) {
          shouldRetryAction.current = false;
          setNotice('Password confirmed. Submit your action again.');
        }
      } catch (failure) {
        if (signal.aborted || isCancelled(failure)) {
          return;
        }
        if (failure instanceof ApiError && failure.code === 'recent_authentication_required') {
          lockReview(request);
          return;
        }
        if (failure instanceof ApiError && failure.code === 'forbidden') {
          setDetail(undefined);
          setPage(undefined);
        }
        const message = failure instanceof ApiError ? failure.message : 'Could not load reports.';
        setError(message);
      } finally {
        if (!signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void load(read);
    return () => controller.abort();
  }, [owner, read]);

  function startRead(request: CaseRead) {
    setIsLoading(true);
    setError('');
    setPasswordRead(undefined);
    setRead(request);
  }

  function lockReview(request: CaseRead) {
    // Discard previously authorized evidence as soon as the server asks for fresh proof.
    setError('');
    setPage(undefined);
    setDetail((current) => {
      if (!current) {
        return undefined;
      }
      return { case: current.case, attachments: [] };
    });
    setIsReviewLocked(true);
    const nextRead = request.kind === 'queue' ? INITIAL_READ : request;
    setPasswordRead(nextRead);
  }

  function openCase(caseId: string) {
    selectedId.current = caseId;
    shouldFocusHeading.current = true;
    setOpenedId(caseId);
    setNotice('');
    startRead({ kind: 'detail', caseId });
  }

  function closeCase() {
    selectedId.current = undefined;
    shouldRetryAction.current = false;
    shouldFocusHeading.current = true;
    setOpenedId(undefined);
    setDetail(undefined);
    setNotice('');
    setError('');
    setPasswordRead(undefined);
    setIsReviewLocked(false);
    if (!page || changedCases.current.size > 0) {
      startRead({ kind: 'queue' });
      return;
    }
    setIsLoading(false);
    setRead(undefined);
  }

  function caseCommitted(action: OperatorAction, caseId: string) {
    const isCaseChanged = action.kind === 'resolve_case' || action.kind === 'extend_evidence';
    if (isCaseChanged) {
      changedCases.current.add(caseId);
    }
    if (selectedId.current === caseId) {
      setNotice(actionNotice(action));
      if (isCaseChanged) {
        startRead({ kind: 'detail', caseId });
      }
      return;
    }
    if (isCaseChanged && !selectedId.current) {
      startRead({ kind: 'queue' });
    }
  }

  function casePasswordRequired(caseId: string) {
    if (selectedId.current !== caseId) {
      return;
    }
    shouldRetryAction.current = true;
    setNotice('');
    setIsLoading(false);
    setRead(undefined);
    lockReview({ kind: 'detail', caseId });
  }

  function confirmPassword() {
    if (passwordRead) {
      startRead({ ...passwordRead });
      heading.current?.focus();
    }
  }

  const feedback = (
    <>
      {passwordRead && <PasswordConfirmation owner={owner} onConfirmed={confirmPassword} />}
      {isLoading && <p role="status">{openedId ? 'Loading case…' : 'Loading reports…'}</p>}
      {error && (
        <>
          <p role="alert" className={accountStyles.error}>
            {error}
          </p>
          {read && (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => startRead({ ...read })}
            >
              Try again
            </button>
          )}
        </>
      )}
    </>
  );

  if (openedId) {
    return (
      <section className={styles.review} aria-label="Case evidence">
        <button type="button" className={styles.textButton} onClick={closeCase}>
          Back to reports
        </button>
        {detail && !isReviewLocked && (
          <button
            type="button"
            className={styles.textButton}
            disabled={isLoading}
            onClick={() => startRead({ kind: 'detail', caseId: openedId })}
          >
            Refresh case
          </button>
        )}
        <h3 ref={heading} tabIndex={-1}>
          Case evidence
        </h3>
        {notice && (
          <p role="status" className={accountStyles.notice}>
            {notice}
          </p>
        )}
        {feedback}
        {detail && (
          <>
            {!isReviewLocked && (
              <>
                <p className={styles.caseSummary}>
                  {reportStatus(detail.case)} · {reportReason(detail.case.reason)} report
                </p>
                <CaseEvidence detail={detail} />
              </>
            )}
            <CaseActions
              owner={owner}
              detail={detail}
              isLocked={isReviewLocked}
              onCommitted={(action) => caseCommitted(action, openedId)}
              onPasswordRequired={() => casePasswordRequired(openedId)}
            />
          </>
        )}
      </section>
    );
  }

  const next = page?.next;
  return (
    <section aria-label="Reported messages">
      <div className={styles.queueHeader}>
        <h3 ref={heading} tabIndex={-1}>
          Reported messages
        </h3>
        {page && (
          <button
            type="button"
            className={styles.textButton}
            disabled={isLoading}
            onClick={() => startRead({ kind: 'queue' })}
          >
            Refresh reports
          </button>
        )}
      </div>
      {feedback}
      {page?.items.length === 0 && <p className={accountStyles.hint}>No reports.</p>}
      {page && page.items.length > 0 && (
        <ul className={styles.reportList}>
          {page.items.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              isLoading={isLoading}
              onOpen={() => openCase(report.id)}
            />
          ))}
        </ul>
      )}
      {next && (
        <button
          type="button"
          className={styles.textButton}
          disabled={isLoading}
          onClick={() => startRead({ kind: 'queue', after: next })}
        >
          Older reports
        </button>
      )}
    </section>
  );
}

function appendPage({
  current,
  next,
  after,
}: {
  current: CasePage | undefined;
  next: CasePage;
  after?: string;
}): CasePage {
  if (!after || !current) {
    return next;
  }
  return { ...next, items: [...current.items, ...next.items] };
}

function updateSummary(current: CasePage | undefined, summary: CaseSummary): CasePage | undefined {
  if (!current) {
    return current;
  }
  const items = current.items.map((report) => (report.id === summary.id ? summary : report));
  return { ...current, items };
}
