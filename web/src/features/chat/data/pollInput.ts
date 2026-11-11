import type { components } from '@/api/schema';
import type { PollMedia } from '@/domain/messages/media';

/** Convert the editor's poll to the canonical creation and edit contract. */
export function pollInput(poll: PollMedia): components['schemas']['PollInput'] {
  return {
    question: poll.question,
    description: poll.description || undefined,
    options: poll.options.map(({ id, text }) => ({ id, text })),
    is_anonymous: !poll.shouldShowVoters,
    is_multiple_choice: poll.canChooseMultiple,
    can_revote: poll.canRevote,
    can_add_options: poll.canAddOptions,
    hide_results_until_close: poll.shouldHideResults,
    closes_at: poll.closesAt === undefined ? undefined : new Date(poll.closesAt).toISOString(),
    quiz: poll.correctOptionIds?.length
      ? {
          correct_option_ids: poll.correctOptionIds,
          explanation: poll.explanation || undefined,
        }
      : undefined,
  };
}
