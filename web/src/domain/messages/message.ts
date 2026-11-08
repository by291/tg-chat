import { z } from 'zod';
import { customEmojiEntitySchema } from './customEmoji';
import { attachmentSchema, messageMediaSchema } from './media';
import { sanitizeRichText } from './richText';

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
  // prettier-ignore
  deliveryStatus: z.enum([
    'queued',
    'sending',
    'accepted',
    'failed',
  ]).optional(),
  isEdited: z.boolean().optional(),
  isPinned: z.boolean().optional(),
});

export type Message = z.infer<typeof messageSchema>;
