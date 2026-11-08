// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createHistoryMessages } from '../demo/historyFixtures';
import { createHistoryRows } from './historyRows';
import { useHistoryWindow } from './useHistoryWindow';

describe('local history paging', () => {
  it('loads older rows while retaining the current window and stable keys', () => {
    const rows = createHistoryRows(createHistoryMessages());
    const { result } = renderHook(() => useHistoryWindow(rows));
    const previousRows = result.current.rows;
    expect(previousRows.length).toBeLessThan(rows.length);

    act(() => result.current.loadOlder());
    expect(result.current.rows.slice(-previousRows.length)).toEqual(previousRows);
    expect(result.current.rows.length).toBeGreaterThan(previousRows.length);
  });

  it('reveals an unloaded reply target and ignores a deleted target', () => {
    const rows = createHistoryRows(createHistoryMessages());
    const { result } = renderHook(() => useHistoryWindow(rows));
    expect(result.current.rows.some((row) => row.key === 'lab-history-12')).toBe(false);

    act(() => result.current.revealMessage('lab-history-12'));
    expect(result.current.rows.some((row) => row.key === 'lab-history-12')).toBe(true);
    const revealedRows = result.current.rows;
    act(() => result.current.revealMessage('deleted-message'));
    expect(result.current.rows).toEqual(revealedRows);
  });
});

it('delegates older history to the remote source without slicing away newly loaded rows', () => {
  const rows = createHistoryRows(createHistoryMessages().slice(0, 100));
  let requests = 0;
  const { result } = renderHook(() =>
    useHistoryWindow(rows, {
      hasOlder: true,
      isLoading: false,
      loadOlder: () => {
        requests += 1;
      },
    }),
  );
  expect(result.current.rows).toEqual(rows);
  act(() => result.current.loadOlder());
  expect(requests).toBe(1);
});
