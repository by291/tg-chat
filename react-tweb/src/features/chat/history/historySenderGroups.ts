import type { VirtualItem } from '@tanstack/react-virtual';
import { CURRENT_USER_ID } from '../model';
import type { HistoryRow } from './historyRows';

const MESSAGE_GAP = 2;
const GROUP_END_GAP = 6;

export interface HistorySenderGroup {
  key: string;
  authorId: string;
  authorName: string;
  start: number;
  end: number;
  firstRowIndex: number;
  lastRowIndex: number;
}

interface SenderGroupOptions {
  rows: HistoryRow[];
  measurements: VirtualItem[];
  renderedItems: VirtualItem[];
  bottomAlignment: number;
}

/** Preserve complete sender bounds even when the group's last message is not mounted. */
export function createHistorySenderGroups(options: SenderGroupOptions): HistorySenderGroup[] {
  const { rows, measurements, renderedItems, bottomAlignment } = options;
  const groups: HistorySenderGroup[] = [];
  let currentGroup: HistorySenderGroup | undefined;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const measurement = measurements[index];
    const hasSender =
      row.kind === 'message' && !row.message.isService && row.message.authorId !== CURRENT_USER_ID;
    if (!hasSender || row.kind !== 'message' || !measurement) {
      currentGroup = undefined;
      continue;
    }

    const gap = row.isGroupEnd ? GROUP_END_GAP : MESSAGE_GAP;
    const end = measurement.end + bottomAlignment - gap;
    if (!currentGroup || row.isGroupStart) {
      currentGroup = {
        key: row.key,
        authorId: row.message.authorId,
        authorName: row.message.authorName,
        start: measurement.start + bottomAlignment,
        end,
        firstRowIndex: index,
        lastRowIndex: index,
      };
      groups.push(currentGroup);
    }

    // The last message keeps the avatar identity stable when older pages extend the group.
    currentGroup.key = row.key;
    currentGroup.end = end;
    currentGroup.lastRowIndex = index;
  }

  return groups.filter((group) => {
    return renderedItems.some((item) => {
      return item.index >= group.firstRowIndex && item.index <= group.lastRowIndex;
    });
  });
}
