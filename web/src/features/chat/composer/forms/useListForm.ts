import { zodResolver } from '@hookform/resolvers/zod';
import type { ChecklistMedia, PollMedia } from '@/domain/messages/media';
import { useFieldArray, useForm, type FieldPathValue } from 'react-hook-form';
import {
  createListEntry,
  INITIAL_POLL_SETTINGS,
  KEEP_POLL_DEADLINE,
  MIN_POLL_OPTIONS,
  type PollSettings,
} from './listComposition';
import { listFormSchema, type ListFormValues } from './listFormSchema';

const FIELD_CHANGE_OPTIONS = { shouldDirty: true, shouldValidate: true };

interface ListFormOptions {
  kind: ListFormValues['kind'];
  initialPoll?: PollMedia;
  initialChecklist?: ChecklistMedia;
  isPollAnonymousOnly?: boolean;
  isConnected?: boolean;
}

function initialValues(options: ListFormOptions): ListFormValues {
  const { kind, initialPoll, initialChecklist, isPollAnonymousOnly, isConnected } = options;
  const settings = { ...INITIAL_POLL_SETTINGS };
  if (initialPoll) {
    settings.shouldShowVoters = Boolean(initialPoll.shouldShowVoters);
    settings.canChooseMultiple = Boolean(initialPoll.canChooseMultiple);
    settings.canAddOptions = Boolean(initialPoll.canAddOptions);
    settings.canRevote = Boolean(initialPoll.canRevote);
    settings.hasCorrectAnswer = Boolean(initialPoll.isQuiz);
    settings.hasTimeLimit = initialPoll.closesAt !== undefined;
    settings.shouldHideResults = Boolean(initialPoll.shouldHideResults);
    // Zero represents retaining the exact existing deadline.
    if (settings.hasTimeLimit) {
      settings.durationHours = KEEP_POLL_DEADLINE;
    }
  }
  if (isPollAnonymousOnly) {
    settings.shouldShowVoters = false;
    settings.canAddOptions = false;
  }
  if (isConnected) {
    settings.shouldShuffleOptions = false;
  }

  return {
    kind,
    title: initialPoll?.question ?? initialChecklist?.title ?? '',
    description: initialPoll?.description ?? '',
    entries:
      initialChecklist?.items.map(({ id, text }) => ({ id, text })) ??
      initialPoll?.options.map(({ id, text }) => ({ id, text })) ??
      Array.from({ length: kind === 'poll' ? MIN_POLL_OPTIONS : 1 }, createListEntry),
    settings,
    // A new answer is entered from scratch; preservation is resolved by the server.
    correctOptionIds: [],
    explanation: '',
    shouldPreserveQuiz: Boolean(initialPoll?.isQuiz),
    canOthersComplete: initialChecklist?.canOthersComplete ?? false,
    canOthersAppend: initialChecklist?.canOthersAppend ?? false,
  };
}

/** Own structured-message fields, stable row operations, and dependent answer validation. */
export function useListForm(options: ListFormOptions) {
  const form = useForm<ListFormValues>({
    mode: 'onChange',
    resolver: zodResolver(listFormSchema),
    defaultValues: initialValues(options),
  });
  const entryFields = useFieldArray({ control: form.control, name: 'entries' });
  const values = form.watch();

  function changeField<Name extends keyof ListFormValues>(
    name: Name,
    value: FieldPathValue<ListFormValues, Name>,
  ) {
    // Root-field writes keep the existing controlled UI, while RHF owns validation and dirty state.
    form.setValue(name, value, FIELD_CHANGE_OPTIONS);
  }

  function updateEntry(index: number, text: string) {
    // setValue preserves the focused input; useFieldArray.update would remount it.
    form.setValue(`entries.${index}.text`, text, FIELD_CHANGE_OPTIONS);
  }

  function removeEntry(index: number) {
    const removedId = form.getValues(`entries.${index}.id`);
    const nextCorrectIds = form.getValues('correctOptionIds').filter((id) => id !== removedId);

    // Remove the answer identity too; a different row can occupy the same index after deletion.
    entryFields.remove(index);
    changeField('correctOptionIds', nextCorrectIds);
  }

  function updateSettings(settings: PollSettings) {
    if (!settings.canChooseMultiple) {
      changeField('correctOptionIds', form.getValues('correctOptionIds').slice(0, 1));
    }

    changeField('settings', settings);
  }

  function selectCorrectAnswer(id: string) {
    const currentIds = form.getValues('correctOptionIds');
    if (!form.getValues('settings.canChooseMultiple')) {
      changeField('correctOptionIds', [id]);
      return;
    }

    const nextIds = currentIds.includes(id)
      ? currentIds.filter((selectedId) => selectedId !== id)
      : [...currentIds, id];

    changeField('correctOptionIds', nextIds);
  }

  return {
    form,
    values,
    changeField,
    updateEntry,
    removeEntry,
    appendEntry: (entry: ReturnType<typeof createListEntry>) => {
      entryFields.append(entry, { shouldFocus: false });
    },
    moveEntry: entryFields.move,
    updateSettings,
    selectCorrectAnswer,
  };
}
