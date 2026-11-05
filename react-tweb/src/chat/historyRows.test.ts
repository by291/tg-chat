import { describe, expect, it } from 'vitest';
import { createInitialState } from './fixtures';
import { createHistoryRows } from './historyRows';

describe('history rows', () => {
  it.each([
    { elapsedSeconds: 121, isGroupStart: false },
    { elapsedSeconds: 122, isGroupStart: true },
  ])('groups adjacent messages at the $elapsedSeconds second boundary', (scenario) => {
    const message = createInitialState().messages[0];
    const millisecondsPerSecond = 1000;
    const nextMessage = {
      ...message,
      id: 'next-message',
      createdAt: message.createdAt + scenario.elapsedSeconds * millisecondsPerSecond,
    };

    const rows = createHistoryRows([message, nextMessage]);
    const nextRow = rows.find((row) => row.key === nextMessage.id);

    expect(nextRow).toMatchObject({ isGroupStart: scenario.isGroupStart });
  });

  it('keeps sender groups across a render-window boundary', () => {
    const messages = createInitialState().messages.slice(0, 2);
    const rows = createHistoryRows(messages);
    const secondMessage = rows.find((row) => row.key === messages[1].id);
    expect(secondMessage).toMatchObject({ isGroupStart: false, isGroupEnd: true });
  });

  it('separates different years even when month and day match', () => {
    const message = createInitialState().messages[0];
    const messages = [
      { ...message, createdAt: new Date('2025-11-05T12:00:00').getTime() },
      { ...message, id: 'next-year', createdAt: new Date('2026-11-05T12:00:00').getTime() },
    ];
    const dates = createHistoryRows(messages).filter((row) => row.kind === 'date');
    expect(dates).toHaveLength(2);
    expect(new Set(dates.map((row) => row.key)).size).toBe(2);
  });

  it('service events interrupt sender groups', () => {
    const message = createInitialState().messages[0];
    const messages = [
      message,
      { ...message, id: 'service', isService: true },
      { ...message, id: 'after-service' },
    ];
    const rows = createHistoryRows(messages);
    expect(rows.find((row) => row.key === 'after-service')).toMatchObject({ isGroupStart: true });
  });
});
