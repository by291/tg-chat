import { z } from 'zod';

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export const MAX_POLL_OPTIONS = 12;
export const MAX_POLL_OPTION_LENGTH = 100;
export const MAX_CHECKLIST_TASKS = 10;
export const MAX_CHECKLIST_TEXT_LENGTH = 255;

export const attachmentSchema = z.object({
  name: z.string(),
  url: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const contactDetailSchema = z.object({
  // These normalized fields can be supplied without storing a raw vCard payload.
  // prettier-ignore
  type: z.enum([
    'phone',
    'email',
    'organization',
    'address',
    'website',
    'note',
    'birthday',
    'name',
  ]),
  value: z.string(),
  label: z.string().optional(),
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
    userId: z.string().min(1).optional(),
    details: z.array(contactDetailSchema).optional(),
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
    voterCount: z.int().nonnegative().optional(),
    selectedOptionId: z.string().optional(),
    selectedOptionIds: z.array(z.string()).optional(),
    description: z.string().optional(),
    shouldShowVoters: z.boolean().optional(),
    canChooseMultiple: z.boolean().optional(),
    canAddOptions: z.boolean().optional(),
    canRevote: z.boolean().optional(),
    canVote: z.boolean().optional(),
    shouldShuffleOptions: z.boolean().optional(),
    correctOptionIds: z.array(z.string()).optional(),
    explanation: z.string().optional(),
    closesAt: z.number().optional(),
    shouldHideResults: z.boolean().optional(),
    isClosed: z.boolean().optional(),
    isQuiz: z.boolean().optional(),
    hasVisibleResults: z.boolean().optional(),
    canClose: z.boolean().optional(),
    canEdit: z.boolean().optional(),
    canViewVoters: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('checklist'),
    title: z.string(),
    items: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          isCompleted: z.boolean(),
          completedBy: z.object({ id: z.string(), name: z.string() }).optional(),
        }),
      )
      .min(1)
      .max(MAX_CHECKLIST_TASKS),
    canOthersComplete: z.boolean(),
    canOthersAppend: z.boolean(),
  }),
]);

export type MessageMedia = z.infer<typeof messageMediaSchema>;
export type PhotoAttachment = z.infer<typeof attachmentSchema>;
export type PollMedia = Extract<MessageMedia, { kind: 'poll' }>;

export type ChecklistMedia = Extract<MessageMedia, { kind: 'checklist' }>;
export type ContactMedia = Extract<MessageMedia, { kind: 'contact' }>;
export type ContactDetail = z.infer<typeof contactDetailSchema>;

export type Attachment = z.infer<typeof attachmentSchema>;
