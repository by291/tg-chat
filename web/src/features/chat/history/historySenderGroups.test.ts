import type { VirtualItem } from '@tanstack/react-virtual';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../demo/fixtures';
import { CURRENT_USER_ID } from '@/domain/identity';
import { createHistoryRows, type HistoryRow } from './historyRows';
import { createHistorySenderGroups } from './historySenderGroups';

const ROW_HEIGHT = 60;
const GROUP_END_GAP = 6;
const BOTTOM_ALIGNMENT = 200;
const initialMessage = createInitialState().messages[0];
const messages = [
  {
    ...initialMessage,
    id: 'first',
    authorId: 'sender',
  },
  {
    ...initialMessage,
    id: 'middle',
    authorId: 'sender',
  },
  {
    ...initialMessage,
    id: 'last',
    authorId: 'sender',
  },
];

function measureRows(rows: HistoryRow[]): VirtualItem[] {
  return rows.map((row, index) => ({
    index,
    key: row.key,
    start: index * ROW_HEIGHT,
    end: (index + 1) * ROW_HEIGHT,
    size: ROW_HEIGHT,
    lane: 0,
  }));
}

describe('history sender groups', () => {
  it('retains the full sender bounds when only a middle message is mounted', () => {
    const rows = createHistoryRows(messages);
    const measurements = measureRows(rows);
    const groups = createHistorySenderGroups({
      rows,
      measurements,
      renderedItems: [measurements[2]],
      bottomAlignment: 0,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: 'last',
      authorId: 'sender',
      start: measurements[1].start,
      end: measurements[3].end - GROUP_END_GAP,
    });
  });

  it('keeps the avatar identity when a partial sender group gains older messages', () => {
    const rows = createHistoryRows(messages);
    const measurements = measureRows(rows);
    const pageRows = rows.slice(2);
    const pageMeasurements = measureRows(pageRows);
    const pageGroups = createHistorySenderGroups({
      rows: pageRows,
      measurements: pageMeasurements,
      renderedItems: pageMeasurements,
      bottomAlignment: 0,
    });
    const expandedGroups = createHistorySenderGroups({
      rows,
      measurements,
      renderedItems: measurements,
      bottomAlignment: 0,
    });

    expect(pageGroups).toHaveLength(1);
    expect(pageGroups[0].key).toBe(expandedGroups[0].key);
    expect(pageGroups[0].start).toBe(pageMeasurements[0].start);
    expect(expandedGroups[0].start).toBe(measurements[1].start);
  });

  it('ends each avatar at sender, service, own-message, and date boundaries', () => {
    const nextDay = new Date(initialMessage.createdAt);
    nextDay.setDate(nextDay.getDate() + 1);
    const rows = createHistoryRows([
      messages[0],
      {
        ...messages[1],
        id: 'other-sender',
        authorId: 'other-sender',
      },
      {
        ...messages[1],
        id: 'service',
        isService: true,
      },
      { ...messages[1], id: 'after-service' },
      {
        ...messages[1],
        id: 'own',
        authorId: CURRENT_USER_ID,
      },
      { ...messages[1], id: 'after-own' },
      {
        ...messages[1],
        id: 'next-day',
        createdAt: nextDay.getTime(),
      },
    ]);
    const measurements = measureRows(rows);
    const groups = createHistorySenderGroups({
      rows,
      measurements,
      renderedItems: measurements,
      bottomAlignment: 0,
    });

    expect(groups.map((group) => group.key)).toEqual([
      'first',
      'other-sender',
      'after-service',
      'after-own',
      'next-day',
    ]);

    for (let index = 1; index < groups.length; index += 1) {
      expect(groups[index - 1].end).toBeLessThan(groups[index].start);
    }
  });

  it('follows updated media measurements and the short-history bottom alignment', () => {
    const rows = createHistoryRows(messages);
    const measurements = measureRows(rows);
    const resizedLastRow = { ...measurements[3], end: ROW_HEIGHT * 6 };
    measurements[3] = resizedLastRow;
    const groups = createHistorySenderGroups({
      rows,
      measurements,
      renderedItems: [measurements[2]],
      bottomAlignment: BOTTOM_ALIGNMENT,
    });

    expect(groups[0].start).toBe(measurements[1].start + BOTTOM_ALIGNMENT);
    expect(groups[0].end).toBe(resizedLastRow.end + BOTTOM_ALIGNMENT - GROUP_END_GAP);
  });

  it('unmounts sender groups outside the rendered history window', () => {
    const rows = createHistoryRows(messages);
    const measurements = measureRows(rows);
    const groups = createHistorySenderGroups({
      rows,
      measurements,
      renderedItems: [measurements[0]],
      bottomAlignment: 0,
    });

    expect(groups).toEqual([]);
  });
});
