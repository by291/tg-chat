import { belongsToSameGroup, formatMessageDate } from '../messageFormatting';
import type { Message } from '@/domain/messages/message';

export type HistoryRow =
  | {
      kind: 'date';
      key: string;
      label: string;
      timestamp: number;
    }
  | {
      kind: 'unread';
      key: string;
      messageId: string;
    }
  | {
      kind: 'message';
      key: string;
      message: Message;
      isGroupStart: boolean;
      isGroupEnd: boolean;
    };

/** Use a distinct virtual row so the unread banner does not change a message's identity. */
export function unreadHistoryRowKey(messageId: string) {
  return `unread-${messageId}`;
}

/** Compute groups before slicing so a virtual boundary never becomes a sender boundary. */
export function createHistoryRows(
  messages: Message[],
  options?: { precedingMessage?: Message; firstUnreadMessageId?: string },
): HistoryRow[] {
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

    const isFirstUnread = message.id === options?.firstUnreadMessageId;
    if (isFirstUnread) {
      rows.push({
        kind: 'unread',
        key: unreadHistoryRowKey(message.id),
        messageId: message.id,
      });
    }

    const nextMessage = messages[index + 1];
    const previousMessage = index === 0 ? options?.precedingMessage : messages[index - 1];
    const endsBeforeUnread = nextMessage && nextMessage.id === options?.firstUnreadMessageId;
    rows.push({
      kind: 'message',
      key: message.id,
      message,
      isGroupStart: isFirstUnread || !belongsToSameGroup(message, previousMessage),
      isGroupEnd: Boolean(endsBeforeUnread) || !belongsToSameGroup(message, nextMessage),
    });
  }

  return rows;
}
