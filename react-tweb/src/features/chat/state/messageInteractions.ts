import {
  MAX_POLL_OPTIONS,
  MAX_POLL_OPTION_LENGTH,
  MAX_CHECKLIST_TASKS,
  MAX_CHECKLIST_TEXT_LENGTH,
} from '../messageMedia';
import type { MessageInteraction } from '../messageInteraction';
import { CURRENT_USER_ID, type Message } from '../model';
import { applyPollSelection } from './pollVoting';

/** Validate local structured-message operations before storing the resulting message. */
export function applyMessageInteraction(
  message: Message,
  interaction: MessageInteraction,
): Message {
  const media = message.media;
  if (interaction.type === 'vote') {
    return applyPollSelection(message, interaction.optionIds);
  }
  if (interaction.type === 'add-option' && media?.kind === 'poll') {
    const text = interaction.text.trim();
    const isClosed = media.closesAt !== undefined && media.closesAt <= Date.now();
    const hasDuplicate = media.options.some((option) => {
      return option.id === interaction.id || option.text === text;
    });
    const canAppend =
      media.canAddOptions && !media.correctOptionIds?.length && !isClosed && !hasDuplicate;
    if (!canAppend || !text || text.length > MAX_POLL_OPTION_LENGTH) {
      return message;
    }
    if (media.options.length >= MAX_POLL_OPTIONS) {
      return message;
    }
    const option = {
      id: interaction.id,
      text,
      votes: 0,
    };
    return { ...message, media: { ...media, options: [...media.options, option] } };
  }
  if (media?.kind !== 'checklist') {
    return message;
  }
  const isOwner = message.authorId === CURRENT_USER_ID;
  if (interaction.type === 'toggle-task') {
    if (message.forwardedFrom || (!isOwner && !media.canOthersComplete)) {
      return message;
    }
    const items = media.items.map((item) => {
      if (item.id !== interaction.taskId) {
        return item;
      }
      return {
        ...item,
        isCompleted: !item.isCompleted,
        completedBy: item.isCompleted ? undefined : { id: CURRENT_USER_ID, name: 'You' },
      };
    });
    return { ...message, media: { ...media, items } };
  }
  if (interaction.type === 'add-task') {
    const text = interaction.text.trim();
    const canAppend = !message.forwardedFrom && (isOwner || media.canOthersAppend);
    const isValidText = text.length > 0 && text.length <= MAX_CHECKLIST_TEXT_LENGTH;
    const hasDuplicateId = media.items.some((item) => item.id === interaction.id);
    if (!canAppend || !isValidText || hasDuplicateId || media.items.length >= MAX_CHECKLIST_TASKS) {
      return message;
    }
    const item = {
      id: interaction.id,
      text,
      isCompleted: false,
    };
    return { ...message, media: { ...media, items: [...media.items, item] } };
  }
  return message;
}
