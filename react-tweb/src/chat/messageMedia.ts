import { z } from 'zod';

export const attachmentSchema = z.object({
  name: z.string(),
  url: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const messageMediaSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('album'),
    photos: z.array(attachmentSchema).min(2).max(10),
  }),
  z.object({
    kind: z.literal('video'),
    url: z.string(),
    poster: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
    duration: z.number().positive(),
    isRound: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('voice'),
    url: z.string(),
    duration: z.number().positive(),
    waveform: z.array(z.number().min(0).max(1)),
  }),
  z.object({
    kind: z.literal('document'),
    name: z.string(),
    url: z.string(),
    size: z.number().nonnegative(),
    mimeType: z.string(),
  }),
  z.object({
    kind: z.literal('link'),
    url: z.url(),
    site: z.string(),
    title: z.string(),
    description: z.string(),
    image: attachmentSchema.optional(),
  }),
  z.object({
    kind: z.literal('contact'),
    name: z.string(),
    phone: z.string(),
    initials: z.string(),
  }),
  z.object({
    kind: z.literal('poll'),
    question: z.string(),
    options: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          votes: z.number().int().nonnegative(),
        }),
      )
      .min(2),
    selectedOptionId: z.string().optional(),
  }),
]);

export type MessageMedia = z.infer<typeof messageMediaSchema>;
export type PhotoAttachment = z.infer<typeof attachmentSchema>;
export type PollMedia = Extract<MessageMedia, { kind: 'poll' }>;
