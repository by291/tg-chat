import { useMemo, useState } from 'react';
import type { HistoryRow } from './historyRows';

export const INITIAL_HISTORY_ROWS = 60;
const HISTORY_PAGE_ROWS = 80;
const NAVIGATION_CONTEXT_ROWS = 12;

/** Expand locally available history without changing the identity of existing rows. */
export function useHistoryWindow(allRows: HistoryRow[]) {
  const [firstLoadedKey, setFirstLoadedKey] = useState(() => {
    const initialIndex = Math.max(0, allRows.length - INITIAL_HISTORY_ROWS);
    return allRows[initialIndex]?.key;
  });
  const startIndex = useMemo(() => {
    const savedIndex = allRows.findIndex((row) => row.key === firstLoadedKey);
    return Math.max(0, savedIndex);
  }, [allRows, firstLoadedKey]);
  // Stable rows keep the virtualizer's key and measurement caches intact during scrolling.
  const rows = useMemo(() => allRows.slice(startIndex), [allRows, startIndex]);

  function loadOlder() {
    const nextIndex = Math.max(0, startIndex - HISTORY_PAGE_ROWS);
    setFirstLoadedKey(allRows[nextIndex]?.key);
  }

  function revealMessage(messageId: string) {
    const targetIndex = allRows.findIndex((row) => row.key === messageId);
    if (targetIndex < 0 || targetIndex >= startIndex) {
      return;
    }

    const nextIndex = Math.max(0, targetIndex - NAVIGATION_CONTEXT_ROWS);
    setFirstLoadedKey(allRows[nextIndex]?.key);
  }

  return {
    rows,
    hasOlder: startIndex > 0,
    loadOlder,
    revealMessage,
  };
}
