import type { Message } from '@/domain/messages/message';
import type { StructuredMessageAction } from './StructuredMessageActions';

export type MessageAction =
  | 'reply'
  | 'edit'
  | 'delete'
  | 'pin'
  | 'copy'
  | 'forward'
  | 'report'
  | 'select'
  | 'copy-selected'
  | 'download-selected'
  | 'forward-selected'
  | 'delete-selected'
  | 'clear-selection';

export type MessageMenuAction = MessageAction | StructuredMessageAction;

export interface MessageCommand {
  action: MessageAction;
  message: Message;
}
