import { z } from 'zod';
import type { MessageInteraction } from './messageInteraction';
import { customEmojiEntitySchema, type CustomEmojiEntity } from './emoji/customEmojiEntities';
import { attachmentSchema, messageMediaSchema } from './messageMedia';
import { sanitizeRichText } from './rich-text/richText';

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
  richText: z.string().transform(sanitizeRichText).optional(),
  customEmoji: z.array(customEmojiEntitySchema).optional(),
  expiresAt: z.number().optional(),
  createdAt: z.number().min(-MAX_DATE_TIMESTAMP).max(MAX_DATE_TIMESTAMP),
  replyToId: z.string().optional(),
  replyQuote: z.object({ text: z.string() }).optional(),
  attachment: attachmentSchema.optional(),
  sticker: z.string().optional(),
  media: messageMediaSchema.optional(),
  forwardedFrom: z.string().optional(),
  isService: z.boolean().optional(),
  // prettier-ignore
  textStyle: z.enum([
    'plain',
    'code',
    'quote',
  ]).optional(),
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

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  initials: z.string(),
  color: z.string(),
  // prettier-ignore
  kind: z.enum([
    'group',
    'private',
    'channel',
    'saved',
  ]).optional(),
  preview: z.string(),
  time: z.string(),
  unreadCount: z.number().optional(),
  isMuted: z.boolean().optional(),
  isVerified: z.boolean().optional(),
  about: z.string().optional(),
  phone: z.string().optional(),
  isContact: z.boolean().optional(),
  memberIds: z.array(z.string()).optional(),
});

export const chatStateSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  messages: z.array(messageSchema),
  drafts: z.record(z.string(), z.string()),
  draftCustomEmoji: z.record(z.string(), z.array(customEmojiEntitySchema)).optional(),
  draftRichText: z.record(z.string(), z.string().transform(sanitizeRichText)).optional(),
  activeChatId: z.string(),
  isDark: z.boolean(),
  conversationPreferences: z.record(z.string(), conversationPreferencesSchema).optional(),
  archivePreferences: archivePreferencesSchema.optional(),
  localConversations: z.array(conversationSchema).optional(),
});

export type Attachment = z.infer<typeof attachmentSchema>;
export type Message = z.infer<typeof messageSchema>;
export type ChatState = z.infer<typeof chatStateSchema>;
export type ConversationPreferences = z.infer<typeof conversationPreferencesSchema>;
export type ArchivePreferences = z.infer<typeof archivePreferencesSchema>;

export type Conversation = z.infer<typeof conversationSchema>;

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
