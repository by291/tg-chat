import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm, type FieldPathValue } from 'react-hook-form';
import {
  createListEntry,
  INITIAL_POLL_SETTINGS,
  MIN_POLL_OPTIONS,
  type PollSettings,
} from './listComposition';
import { listFormSchema, type ListFormValues } from './listFormSchema';

const FIELD_CHANGE_OPTIONS = { shouldDirty: true, shouldValidate: true };

/** Own structured-message fields, stable row operations, and dependent answer validation. */
export function useListForm(kind: ListFormValues['kind']) {
  const form = useForm<ListFormValues>({
    mode: 'onChange',
    resolver: zodResolver(listFormSchema),
    defaultValues: {
      kind,
      title: '',
      description: '',
      entries: Array.from({ length: kind === 'poll' ? MIN_POLL_OPTIONS : 1 }, createListEntry),
      settings: INITIAL_POLL_SETTINGS,
      correctOptionIds: [],
      explanation: '',
      canOthersComplete: false,
      canOthersAppend: false,
    },
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
