import { useEffect, useRef, useState } from 'react';
import type { components } from '@/api/schema';
import {
  ApiError,
  isCancelled,
  requirePayload,
  type SessionOwner,
} from '@/features/auth/SessionOwner';

const INITIAL_READ = { kind: 'queue' } as const;

type CasePage = components['schemas']['CasePage'];
type CaseDetail = components['schemas']['CaseDetail'];
type OperatorAction = components['schemas']['OperatorAction'];

type CaseRead = { kind: 'queue'; after?: string } | { kind: 'detail'; caseId: string };

type CaseSummary = components['schemas']['CaseSummary'];

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

/** Own the report queue, selected evidence, and the recent-authentication transition. */
export function useCaseReview(owner: SessionOwner) {
  const [page, setPage] = useState<CasePage>();
  const [detail, setDetail] = useState<CaseDetail>();
  const [openedId, setOpenedId] = useState<string>();
  const [read, setRead] = useState<CaseRead | undefined>(INITIAL_READ);
  const [passwordRead, setPasswordRead] = useState<CaseRead>();
  const [isReviewLocked, setIsReviewLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selectedId = useRef<string>(undefined);
  const changedCases = useRef(new Set<string>());
  const shouldRetryAction = useRef(false);

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

        // Fresh proof restores evidence access. The operator must confirm the action again.
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

    // Switching between the queue and detail invalidates the previous response.
    return () => controller.abort();
  }, [owner, read]);

  function startRead(request: CaseRead) {
    setIsLoading(true);
    setError('');
    setPasswordRead(undefined);
    setRead(request);
  }

  function lockReview(request: CaseRead) {
    // Keep the case and form in place while withdrawing access to the evidence.
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
    setOpenedId(caseId);
    setNotice('');
    startRead({ kind: 'detail', caseId });
  }

  function closeCase() {
    selectedId.current = undefined;
    shouldRetryAction.current = false;
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
    }
  }

  return {
    page,
    detail,
    openedId,
    read,
    passwordRead,
    isReviewLocked,
    isLoading,
    error,
    notice,
    startRead,
    openCase,
    closeCase,
    caseCommitted,
    casePasswordRequired,
    confirmPassword,
  };
}
