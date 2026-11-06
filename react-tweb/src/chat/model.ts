import { z } from 'zod';
import { attachmentSchema, messageMediaSchema } from './messageMedia';

export { attachmentSchema } from './messageMedia';

export const CURRENT_USER_ID = 'you';
export const DEFAULT_CHAT_ID = 'dev';
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
// tweb groups adjacent messages through the inclusive 121-second boundary.
export const MESSAGE_GROUP_INTERVAL = 121_000;
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

export const messageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  text: z.string(),
  expiresAt: z.number().optional(),
  createdAt: z.number().min(-MAX_DATE_TIMESTAMP).max(MAX_DATE_TIMESTAMP),
  replyToId: z.string().optional(),
  attachment: attachmentSchema.optional(),
  sticker: z.string().optional(),
  media: messageMediaSchema.optional(),
  forwardedFrom: z.string().optional(),
  isService: z.boolean().optional(),
  textStyle: z.enum(['plain', 'code', 'quote']).optional(),
  reactions: z.array(z.string()),
  isEdited: z.boolean().optional(),
  isPinned: z.boolean().optional(),
});

export const conversationPreferencesSchema = z.object({
  autoDeleteDays: z.int().nonnegative().optional(),
  isPinned: z.boolean().optional(),
  pinnedOrder: z.int().nonnegative().optional(),
  isMuted: z.boolean().optional(),
  mutedUntil: z.number().nonnegative().optional(),
  isArchived: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  isMarkedUnread: z.boolean().optional(),
  unreadCount: z.int().nonnegative().optional(),
  hasClearedHistory: z.boolean().optional(),
});

export const archivePreferencesSchema = z.object({
  showInChatList: z.boolean().optional(),
  keepUnmutedArchived: z.boolean().optional(),
});

export const chatStateSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  messages: z.array(messageSchema),
  drafts: z.record(z.string(), z.string()),
  activeChatId: z.string(),
  isDark: z.boolean(),
  conversationPreferences: z.record(z.string(), conversationPreferencesSchema).optional(),
  archivePreferences: archivePreferencesSchema.optional(),
});

export type Attachment = z.infer<typeof attachmentSchema>;
export type Message = z.infer<typeof messageSchema>;
export type ChatState = z.infer<typeof chatStateSchema>;
export type ConversationPreferences = z.infer<typeof conversationPreferencesSchema>;
export type ArchivePreferences = z.infer<typeof archivePreferencesSchema>;

export interface Conversation {
  id: string;
  title: string;
  subtitle: string;
  initials: string;
  color: string;
  kind?: 'group' | 'private' | 'channel' | 'saved';
  preview: string;
  time: string;
  unreadCount?: number;
  isMuted?: boolean;
  isVerified?: boolean;
}

export type ChatAction =
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
    }
  | {
      type: 'send' | 'forward';
      message: Message;
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
    }
  | {
      type: 'delete';
      chatId: string;
      messageId: string;
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
    }
  | {
      type: 'vote';
      chatId: string;
      messageId: string;
      optionId: string;
    }
  | {
      type: 'toggle-theme';
    };

export type MessageAction = 'reply' | 'edit' | 'delete' | 'pin' | 'copy' | 'forward';

export interface MessageCommand {
  action: MessageAction;
  message: Message;
}
