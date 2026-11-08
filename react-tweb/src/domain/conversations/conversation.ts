import { z } from 'zod';

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

export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationPreferences = z.infer<typeof conversationPreferencesSchema>;
export type ArchivePreferences = z.infer<typeof archivePreferencesSchema>;
