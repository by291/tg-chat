import { describe, expect, it } from 'vitest';
import type { VirtualItem } from '@tanstack/react-virtual';
import { createInitialState } from '../demo/fixtures';
import { createHistoryRows } from './historyRows';
import { createHistoryDateGroups, getActiveHistoryDateKey } from './historyDates';

const message = createInitialState().messages[0];
const firstDay = new Date(2026, 10, 3).getTime();
const nextDay = new Date(2026, 10, 4).getTime();
const rows = createHistoryRows([
  { ...message, createdAt: firstDay },
  { ...message, id: 'next-day', createdAt: nextDay },
]);

function measuredRow(index: number, start: number): VirtualItem {
  const height = 40;
  return {
    index,
    key: rows[index].key,
    start,
    end: start + height,
    size: height,
    lane: 0,
  };
}

const measurements = [
  measuredRow(0, 40),
  measuredRow(1, 80),
  measuredRow(2, 240),
  measuredRow(3, 280),
];

describe('sticky history dates', () => {
  it('keeps the current day mounted when its separator leaves the virtual range', () => {
    const groups = createHistoryDateGroups({
      rows,
      measurements,
      renderedItems: [measurements[1]],
      bottomAlignment: 0,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].date.timestamp).toBe(firstDay);
    expect(groups[0].start).toBe(measurements[0].start);
    expect(groups[0].end).toBe(measurements[2].start);
  });

  it('bounds the old sticky header by the next date group while keeping both mounted', () => {
    const groups = createHistoryDateGroups({
      rows,
      measurements,
      renderedItems: [measurements[1], measurements[3]],
      bottomAlignment: 0,
    });
    expect(groups).toHaveLength(2);
    expect(groups[0].end).toBe(groups[1].start);
    expect(groups[1].end).toBe(measurements[3].end);
    expect(getActiveHistoryDateKey({ groups, scrollOffset: 250, topInset: 0 })).toBe(
      groups[1].date.key,
    );
  });

  it('recovers a paged day without placing its header over the first loaded message', () => {
    const pageMeasurements = measurements.slice(1).map((item) => ({
      ...item,
      index: item.index - 1,
    }));
    const groups = createHistoryDateGroups({
      rows: rows.slice(1),
      measurements: pageMeasurements,
      renderedItems: [pageMeasurements[0]],
      bottomAlignment: 0,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].date.timestamp).toBe(firstDay);
    expect(groups[0].start).toBeLessThan(pageMeasurements[0].start);
    expect(groups[0].end).toBe(pageMeasurements[1].start);

    const expandedGroups = createHistoryDateGroups({
      rows,
      measurements,
      renderedItems: [measurements[1]],
      bottomAlignment: 0,
    });
    expect(expandedGroups[0].date.key).toBe(groups[0].date.key);
  });

  it('leaves an inline date visible until it crosses the sticky boundary', () => {
    const groups = createHistoryDateGroups({
      rows,
      measurements,
      renderedItems: measurements,
      bottomAlignment: 0,
    });
    expect(getActiveHistoryDateKey({ groups, scrollOffset: 36, topInset: 0 })).toBeUndefined();
    expect(getActiveHistoryDateKey({ groups, scrollOffset: 41, topInset: 0 })).toBe(
      groups[0].date.key,
    );
  });

  it('keeps dates in a short bottom-aligned history below the floating header', () => {
    const groups = createHistoryDateGroups({
      rows,
      measurements,
      renderedItems: measurements,
      bottomAlignment: 200,
    });
    expect(getActiveHistoryDateKey({ groups, scrollOffset: 0, topInset: 64 })).toBeUndefined();
    expect(groups[0].start).toBe(measurements[0].start + 200);
  });
});
