import type { Message } from '@/domain/messages/message';
import type { PollMedia } from '@/domain/messages/media';

/** Read both current multi-answer selections and previously saved single-answer polls. */
export function getSelectedPollOptions(poll: PollMedia): string[] {
  if (poll.selectedOptionIds) {
    return poll.selectedOptionIds;
  }
  return poll.selectedOptionId ? [poll.selectedOptionId] : [];
}

/** Replace this device's entire selection without changing other voters' counts. */
export function applyPollSelection(message: Message, optionIds: string[]): Message {
  const poll = message.media;
  if (poll?.kind !== 'poll') {
    return message;
  }
  const previousIds = getSelectedPollOptions(poll);
  const selectedIds = [...new Set(optionIds)];
  const isClosed = poll.closesAt !== undefined && poll.closesAt <= Date.now();
  const cannotRevote = poll.canRevote === false && previousIds.length > 0;
  const hasUnknownOption = selectedIds.some(
    (id) => !poll.options.some((option) => option.id === id),
  );
  const hasTooManyAnswers = !poll.canChooseMultiple && selectedIds.length > 1;
  if (isClosed || cannotRevote || hasUnknownOption || hasTooManyAnswers || !selectedIds.length) {
    return message;
  }
  const isUnchanged =
    selectedIds.length === previousIds.length &&
    selectedIds.every((id) => previousIds.includes(id));
  if (isUnchanged) {
    return message;
  }
  const options = poll.options.map((option) => {
    const previousVote = previousIds.includes(option.id) ? 1 : 0;
    const nextVote = selectedIds.includes(option.id) ? 1 : 0;
    return { ...option, votes: Math.max(0, option.votes - previousVote + nextVote) };
  });
  const previousVoterCount =
    poll.voterCount ?? poll.options.reduce((total, option) => total + option.votes, 0);
  const voterCount = previousVoterCount + (previousIds.length ? 0 : 1);
  return {
    ...message,
    media: {
      ...poll,
      options,
      voterCount,
      selectedOptionId: selectedIds[0],
      selectedOptionIds: selectedIds,
    },
  };
}
