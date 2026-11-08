import { z } from 'zod';
import {
  MAX_CHECKLIST_TASKS,
  MAX_POLL_OPTIONS,
  MAX_POLL_OPTION_LENGTH,
} from '@/domain/messages/media';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_EXPLANATION_LENGTH,
  MAX_TITLE_LENGTH,
  MIN_POLL_OPTIONS,
} from './listComposition';

const pollSettingsSchema = z.object({
  shouldShowVoters: z.boolean(),
  canChooseMultiple: z.boolean(),
  canAddOptions: z.boolean(),
  canRevote: z.boolean(),
  shouldShuffleOptions: z.boolean(),
  hasCorrectAnswer: z.boolean(),
  hasTimeLimit: z.boolean(),
  durationHours: z.number().positive().finite(),
  shouldHideResults: z.boolean(),
});

export const listFormSchema = z
  .object({
    kind: z.enum(['poll', 'checklist']),
    title: z.string().trim().min(1, 'Enter a title.').max(MAX_TITLE_LENGTH),
    description: z.string().max(MAX_DESCRIPTION_LENGTH),
    entries: z.array(z.object({ id: z.string(), text: z.string() })),
    settings: pollSettingsSchema,
    correctOptionIds: z.array(z.string()),
    explanation: z.string().max(MAX_EXPLANATION_LENGTH),
    canOthersComplete: z.boolean(),
    canOthersAppend: z.boolean(),
  })
  .superRefine((values, context) => {
    const isPoll = values.kind === 'poll';
    const filledEntries = values.entries.filter((entry) => entry.text.trim());
    const minimum = isPoll ? MIN_POLL_OPTIONS : 1;
    const maximum = isPoll ? MAX_POLL_OPTIONS : MAX_CHECKLIST_TASKS;
    const maximumLength = isPoll ? MAX_POLL_OPTION_LENGTH : MAX_TITLE_LENGTH;
    const hasBlankTask = !isPoll && filledEntries.length !== values.entries.length;
    const hasInvalidLength = filledEntries.some((entry) => entry.text.length > maximumLength);
    const hasInvalidCount = filledEntries.length < minimum || values.entries.length > maximum;
    if (hasBlankTask || hasInvalidCount || hasInvalidLength) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: isPoll ? 'Enter at least two valid options.' : 'Fill in every task.',
      });
    }
    if (!isPoll) {
      return;
    }

    const uniqueAnswers = new Set(filledEntries.map((entry) => entry.text.trim()));
    if (uniqueAnswers.size !== filledEntries.length) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Each option must have a different answer.',
      });
    }
    const validCorrectIds = values.correctOptionIds.filter((id) => {
      return filledEntries.some((entry) => entry.id === id);
    });
    const hasCorrectAnswer = validCorrectIds.length > 0;
    const hasTooManyAnswers = !values.settings.canChooseMultiple && validCorrectIds.length > 1;
    if (values.settings.hasCorrectAnswer && (!hasCorrectAnswer || hasTooManyAnswers)) {
      context.addIssue({
        code: 'custom',
        path: ['correctOptionIds'],
        message: 'Select a correct answer.',
      });
    }
  });

export type ListFormValues = z.infer<typeof listFormSchema>;
