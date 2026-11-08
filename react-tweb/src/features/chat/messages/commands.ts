import type { Message } from '@/domain/messages/message';

export type MessageAction =
  | 'reply'
  | 'edit'
  | 'delete'
  | 'pin'
  | 'copy'
  | 'forward'
  | 'select'
  | 'copy-selected'
  | 'download-selected'
  | 'forward-selected'
  | 'delete-selected'
  | 'clear-selection';

export interface MessageCommand {
  action: MessageAction;
  message: Message;
}
