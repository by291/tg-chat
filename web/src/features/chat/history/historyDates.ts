import type { VirtualItem } from '@tanstack/react-virtual';
import type { HistoryRow } from './historyRows';
import { formatMessageDate } from '../messageFormatting';

// A 29px pill plus 5px bottom padding and 2px margin forms Telegram's sticky date row.
export const HISTORY_DATE_ROW_HEIGHT = 36;
const STICKY_DATE_INSET = 3;

type DateRow = Extract<HistoryRow, { kind: 'date' }>;

export interface HistoryDateGroup {
  date: DateRow;
  start: number;
  end: number;
  firstRowIndex: number;
  lastRowIndex: number;
}

interface DateGroupOptions {
  rows: HistoryRow[];
  measurements: VirtualItem[];
  renderedItems: VirtualItem[];
  bottomAlignment: number;
}

interface ActiveDateOptions {
  groups: HistoryDateGroup[];
  scrollOffset: number;
  topInset: number;
}

function getDateGroupKey(timestamp: number) {
  const day = new Date(timestamp);
  day.setHours(0, 0, 0, 0);
  return `history-date-${day.getTime()}`;
}

function getRowDate(row: HistoryRow, index: number): DateRow | undefined {
  if (row.kind === 'date') {
    return { ...row, key: getDateGroupKey(row.timestamp) };
  }
  if (index !== 0 || row.kind !== 'message') {
    return undefined;
  }

  // A paged window can begin mid-day; its date still owns the messages in that first group.
  return {
    kind: 'date',
    key: getDateGroupKey(row.message.createdAt),
    label: formatMessageDate(row.message.createdAt),
    timestamp: row.message.createdAt,
  };
}

/** Keep each visible day's header mounted even when its date row leaves the virtual range. */
export function createHistoryDateGroups(options: DateGroupOptions): HistoryDateGroup[] {
  const { rows, measurements, renderedItems, bottomAlignment } = options;
  const lastMeasurement = measurements.at(-1);
  if (!lastMeasurement) {
    return [];
  }

  const groups: HistoryDateGroup[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const date = getRowDate(row, index);
    const measurement = measurements[index];
    if (!date || !measurement) {
      continue;
    }

    const rowStart = measurement.start + bottomAlignment;
    const previousGroup = groups.at(-1);
    if (previousGroup) {
      previousGroup.end = rowStart;
      previousGroup.lastRowIndex = index - 1;
    }
    // Missing separators belong before the loaded page and must not cover its first message.
    const start = row.kind === 'date' ? rowStart : rowStart - HISTORY_DATE_ROW_HEIGHT;
    groups.push({
      date,
      start,
      end: lastMeasurement.end + bottomAlignment,
      firstRowIndex: index,
      lastRowIndex: rows.length - 1,
    });
  }

  return groups.filter((group) => {
    return renderedItems.some((item) => {
      return item.index >= group.firstRowIndex && item.index <= group.lastRowIndex;
    });
  });
}

/** Identify the active sticky day; earlier groups retain their ordinary opacity while leaving. */
export function getActiveHistoryDateKey(options: ActiveDateOptions) {
  const { groups, scrollOffset, topInset } = options;
  const boundary = scrollOffset + topInset + STICKY_DATE_INSET;
  const group = groups.find((entry) => entry.start < boundary && entry.end > boundary);

  return group?.date.key;
}
