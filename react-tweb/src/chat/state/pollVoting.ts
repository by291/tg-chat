import type { Message } from '../model';

/** Replace this device's previous poll vote without changing other voters' counts. */
export function applyPollVote(message: Message, optionId: string): Message {
  const poll = message.media;
  if (poll?.kind !== 'poll' || poll.selectedOptionId === optionId) {
    return message;
  }

  if (!poll.options.some((option) => option.id === optionId)) {
    return message;
  }

  const options = poll.options.map((option) => {
    let votes = option.votes;
    if (option.id === poll.selectedOptionId) {
      votes = Math.max(0, votes - 1);
    }
    if (option.id === optionId) {
      votes += 1;
    }
    return { ...option, votes };
  });

  return {
    ...message,
    media: { ...poll, options, selectedOptionId: optionId },
  };
}
