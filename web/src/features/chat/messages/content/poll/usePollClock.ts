import { useEffect, useReducer } from 'react';

const MAX_TIMEOUT_MS = 2_147_483_647;

/** Refresh a visible poll surface at its server deadline, including deadlines beyond one timer. */
export function usePollClock(deadline?: number) {
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  const now = Date.now();
  const hasExpired = deadline !== undefined && deadline <= now;
  useEffect(() => {
    if (deadline === undefined || hasExpired) {
      return;
    }

    let timer: number;
    const wake = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        refresh();
        return;
      }
      timer = window.setTimeout(wake, Math.min(remaining, MAX_TIMEOUT_MS));
    };
    wake();
    return () => window.clearTimeout(timer);
  }, [deadline, hasExpired]);

  return now;
}
