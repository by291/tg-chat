import type { MessageMedia } from '@/domain/messages/media';

export const MIN_POLL_OPTIONS = 2;
export const KEEP_POLL_DEADLINE = 0;
export const MAX_TITLE_LENGTH = 255;
export const MAX_DESCRIPTION_LENGTH = 1024;
export const MAX_EXPLANATION_LENGTH = 200;
export const MILLISECONDS_PER_HOUR = 3_600_000;

export const INITIAL_POLL_SETTINGS: PollSettings = {
  shouldShowVoters: true,
  canChooseMultiple: true,
  canAddOptions: true,
  canRevote: true,
  shouldShuffleOptions: true,
  hasCorrectAnswer: false,
  hasTimeLimit: false,
  durationHours: 24,
  shouldHideResults: false,
};

export interface ListEntry {
  id: string;
  text: string;
}

export interface PollSettings {
  shouldShowVoters: boolean;
  canChooseMultiple: boolean;
  canAddOptions: boolean;
  canRevote: boolean;
  shouldShuffleOptions: boolean;
  hasCorrectAnswer: boolean;
  hasTimeLimit: boolean;
  durationHours: number;
  shouldHideResults: boolean;
}

/** Give editable rows stable identities across additions, deletions, and reordering. */
export function createListEntry(): ListEntry {
  return { id: crypto.randomUUID(), text: '' };
}

/** Apply Telegram's dependent poll settings without leaving contradictory switches enabled. */
export function changePollSetting({
  settings,
  name,
  isEnabled,
}: {
  settings: PollSettings;
  name: keyof Omit<PollSettings, 'durationHours'>;
  isEnabled: boolean;
}): PollSettings {
  const next = { ...settings, [name]: isEnabled };
  if (name === 'shouldShowVoters' && !isEnabled) {
    next.canAddOptions = false;
  }
  if (name === 'hasCorrectAnswer' && isEnabled) {
    next.canAddOptions = false;
    next.canRevote = false;
  }
  return next;
}

function shuffleAnswers(options: Extract<MessageMedia, { kind: 'poll' }>['options']) {
  for (let index = options.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(Math.random() * (index + 1));
    const option = options[index];
    options[index] = options[otherIndex];
    options[otherIndex] = option;
  }
}

/** Build serializable poll content; blank trailing editor rows never become answers. */
export function composePoll({
  title,
  description,
  entries,
  settings,
  correctOptionIds,
  explanation,
  previousDeadline,
  isConnected,
}: {
  title: string;
  description: string;
  entries: ListEntry[];
  settings: PollSettings;
  correctOptionIds: string[];
  explanation: string;
  previousDeadline?: number;
  isConnected?: boolean;
}): MessageMedia {
  const options = entries
    .filter((entry) => entry.text.trim())
    .map((entry) => ({
      id: entry.id,
      text: entry.text.trim(),
      votes: 0,
    }));
  // This demo has one voter. Persist their shuffled order across virtual row remounts.
  if (settings.shouldShuffleOptions) {
    shuffleAnswers(options);
  }
  let closesAt: number | undefined;
  if (settings.hasTimeLimit) {
    closesAt =
      settings.durationHours === KEEP_POLL_DEADLINE
        ? previousDeadline
        : Date.now() + settings.durationHours * MILLISECONDS_PER_HOUR;
  }

  return {
    kind: 'poll',
    question: title.trim(),
    description: description.trim(),
    options,
    shouldShowVoters: settings.shouldShowVoters,
    canChooseMultiple: settings.canChooseMultiple,
    canAddOptions: settings.canAddOptions,
    canRevote: settings.canRevote,
    shouldShuffleOptions: settings.shouldShuffleOptions,
    correctOptionIds: settings.hasCorrectAnswer ? correctOptionIds : undefined,
    explanation: settings.hasCorrectAnswer ? explanation.trim() : undefined,
    closesAt,
    shouldHideResults: (isConnected || settings.hasTimeLimit) && settings.shouldHideResults,
  };
}
