import { z } from 'zod';
import type { components } from '@/api/schema';
import { customEmojiEntitySchema } from './customEmoji';
import { attachmentSchema, messageMediaSchema, type MessageMedia } from './media';
import { sanitizeRichText } from './richText';

// tweb groups adjacent messages through the inclusive 121-second boundary.
// prettier-ignore
const DELIVERY_STATUSES = [
  'queued',
  'sending',
  'accepted',
  'failed',
] as const;

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
  isRead: z.boolean().optional(),
  isReplyUnavailable: z.boolean().optional(),
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
  reactionDetails: z
    .array(
      z.object({
        emoji: z.string(),
        count: z.string(),
        isSelected: z.boolean(),
      }),
    )
    .optional(),
  // prettier-ignore
  deliveryError: z.string().optional(),
  deliveryStatus: z.enum(DELIVERY_STATUSES).optional(),
  isEdited: z.boolean().optional(),
  isPinned: z.boolean().optional(),
});

export interface PendingMediaDisplayItem {
  occurrenceId: string;
  filename: string;
  kind: components['schemas']['UploadPurpose'];
  previewSource?: Blob;
  isReady: boolean;
  progress?: { phase: 'uploading' | 'processing'; percentage: number };
}

export interface PendingMediaDisplay {
  status: string;
  canRestart?: boolean;
  error?: string;
  activeOccurrenceId: string;
  items: PendingMediaDisplayItem[];
}

export type Message = z.infer<typeof messageSchema> & {
  disableLinkPreview?: boolean;
  missedCallMode?: components['schemas']['CallMode'];
  linkPreview?: Extract<MessageMedia, { kind: 'link' }>;
  remoteAttachments?: components['schemas']['AttachmentView'][];
  pendingMedia?: PendingMediaDisplay;
  downloadOriginalUrl?: (signal: AbortSignal) => Promise<string>;
  renewPreviewUrl?: (signal: AbortSignal) => Promise<string>;
  renewPlaybackUrl?: (signal: AbortSignal) => Promise<string>;
};
