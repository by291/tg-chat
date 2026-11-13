import { useEffect, useId, useRef } from 'react';
import type { components } from '@/api/schema';
import accountStyles from '@/features/accounts/Accounts.module.css';
import { PasswordConfirmation } from '@/features/accounts/SecurityPanel';
import { type SessionOwner } from '@/features/auth/SessionOwner';
import { CaseActions } from './CaseActions';
import { CaseEvidence } from './CaseEvidence';
import { useCaseReview } from './useCaseReview';
import styles from './OperatorWorkspace.module.css';

type CaseSummary = components['schemas']['CaseSummary'];

function reportReason(reason: string): string {
  return reason.replaceAll('_', ' ');
}

function reportStatus(report: CaseSummary): string {
  return report.resolved_at ? 'Resolved' : 'Open';
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
  const review = useCaseReview(owner);
  const { page, detail, openedId, read, passwordRead, isReviewLocked, isLoading, error, notice } =
    review;

  const heading = useRef<HTMLHeadingElement>(null);
  const shouldFocusHeading = useRef(false);
  useEffect(() => {
    if (shouldFocusHeading.current) {
      heading.current?.focus();
      shouldFocusHeading.current = false;
    }
  }, [openedId]);

  function openCase(caseId: string) {
    shouldFocusHeading.current = true;
    review.openCase(caseId);
  }

  function closeCase() {
    shouldFocusHeading.current = true;
    review.closeCase();
  }

  function confirmPassword() {
    review.confirmPassword();
    heading.current?.focus();
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
              onClick={() => review.startRead({ ...read })}
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
            onClick={() => review.startRead({ kind: 'detail', caseId: openedId })}
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
              onCommitted={(action) => review.caseCommitted(action, openedId)}
              onPasswordRequired={() => review.casePasswordRequired(openedId)}
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
            onClick={() => review.startRead({ kind: 'queue' })}
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
          onClick={() => review.startRead({ kind: 'queue', after: next })}
        >
          Older reports
        </button>
      )}
    </section>
  );
}
