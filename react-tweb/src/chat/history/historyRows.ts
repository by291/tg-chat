import { belongsToSameGroup, formatMessageDate } from '../messageFormatting';
import type { Message } from '../model';

export type HistoryRow =
  | {
      kind: 'date';
      key: string;
      label: string;
      timestamp: number;
    }
  | {
      kind: 'message';
      key: string;
      message: Message;
      isGroupStart: boolean;
      isGroupEnd: boolean;
    };

/** Compute groups before slicing so a virtual boundary never becomes a sender boundary. */
export function createHistoryRows(messages: Message[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  let previousDate = '';

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const dateKey = new Date(message.createdAt).toDateString();
    if (dateKey !== previousDate) {
      rows.push({
        kind: 'date',
        key: `date-${message.id}`,
        label: formatMessageDate(message.createdAt),
        timestamp: message.createdAt,
      });
      previousDate = dateKey;
    }

    const nextMessage = messages[index + 1];
    rows.push({
      kind: 'message',
      key: message.id,
      message,
      isGroupStart: !belongsToSameGroup(message, messages[index - 1]),
      isGroupEnd: !nextMessage || !belongsToSameGroup(nextMessage, message),
    });
  }

  return rows;
}
