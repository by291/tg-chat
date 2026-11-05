import { z } from 'zod';

export const CURRENT_USER_ID = 'you';
export const DEFAULT_CHAT_ID = 'dev';
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MESSAGE_GROUP_INTERVAL = 5 * 60 * 1000;
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

export const attachmentSchema = z.object({
  name: z.string(),
  url: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const messageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  text: z.string(),
  createdAt: z.number().min(-MAX_DATE_TIMESTAMP).max(MAX_DATE_TIMESTAMP),
  replyToId: z.string().optional(),
  attachment: attachmentSchema.optional(),
  sticker: z.string().optional(),
  reactions: z.array(z.string()),
  isEdited: z.boolean().optional(),
  isPinned: z.boolean().optional(),
});

export const chatStateSchema = z.object({
  version: z.literal(1),
  messages: z.array(messageSchema),
  drafts: z.record(z.string(), z.string()),
  activeChatId: z.string(),
  isDark: z.boolean(),
});

export type Attachment = z.infer<typeof attachmentSchema>;
export type Message = z.infer<typeof messageSchema>;
export type ChatState = z.infer<typeof chatStateSchema>;

export interface Conversation {
  id: string;
  title: string;
  subtitle: string;
  initials: string;
  color: string;
  preview: string;
  time: string;
  unreadCount?: number;
  isMuted?: boolean;
  isVerified?: boolean;
}

export type ChatAction =
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
      type: 'send';
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
      type: 'toggle-theme';
    };

export type MessageAction = 'reply' | 'edit' | 'delete' | 'pin' | 'copy';

export interface MessageCommand {
  action: MessageAction;
  message: Message;
}
