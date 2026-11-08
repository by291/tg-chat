import type { CustomEmojiEntity } from '@/domain/messages/customEmoji';
import type { MessageInteraction } from '@/domain/messages/interaction';
import type { Message } from '@/domain/messages/message';
import type {
  ArchivePreferences,
  Conversation,
  ConversationPreferences,
} from '@/domain/conversations/conversation';
import type { ChatState } from './chatState';

export type ChatAction =
  | {
      type: 'save-conversation';
      conversation: Conversation;
    }
  | {
      type: 'interact';
      chatId: string;
      messageId: string;
      interaction: MessageInteraction;
    }
  | {
      type: 'expire-messages';
      now: number;
    }
  | {
      type: 'update-archive-preferences';
      changes: ArchivePreferences;
    }
  | {
      type: 'reorder-pinned-conversations';
      chatIds: string[];
    }
  | {
      type: 'update-conversations';
      chatIds: string[];
      changes: ConversationPreferences;
    }
  | {
      type: 'clear-conversations';
      chatIds: string[];
      mode: 'history' | 'delete';
    }
  | {
      type: 'restore';
      state: ChatState;
    }
  | {
      type: 'select-chat';
      chatId: string;
    }
  | {
      type: 'set-draft';
      chatId: string;
      text: string;
      richText?: string;
      customEmoji?: CustomEmojiEntity[];
    }
  | {
      type: 'send' | 'forward';
      message: Message;
    }
  | {
      type: 'forward-messages';
      messages: Message[];
    }
  | {
      type: 'receive';
      message: Message;
    }
  | {
      type: 'edit';
      chatId: string;
      messageId: string;
      text: string;
      richText?: string;
      customEmoji?: CustomEmojiEntity[];
    }
  | {
      type: 'delete';
      chatId: string;
      messageId: string;
    }
  | {
      type: 'delete-messages';
      chatId: string;
      messageIds: string[];
    }
  | {
      type: 'react';
      chatId: string;
      messageId: string;
      emoji: string;
    }
  | {
      type: 'pin';
      chatId: string;
      messageId: string;
      isPinned: boolean;
    }
  | {
      type: 'toggle-theme';
    };
