import { z } from 'zod';
import { customEmojiEntitySchema } from '@/domain/messages/customEmoji';
import { messageSchema } from '@/domain/messages/message';
import { sanitizeRichText } from '@/domain/messages/richText';
import {
  archivePreferencesSchema,
  conversationPreferencesSchema,
  conversationSchema,
} from '@/domain/conversations/conversation';

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

export type ChatState = z.infer<typeof chatStateSchema>;
