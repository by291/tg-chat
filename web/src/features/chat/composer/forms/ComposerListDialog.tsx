import { MAX_POLL_OPTIONS, MAX_POLL_OPTION_LENGTH, type PollMedia } from '@/domain/messages/media';
import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, useState } from 'react';
import { isCancelled } from '@/features/auth/SessionOwner';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import type { ComposedMessage } from '../MessageComposer';
import { ListEntryFields, ListSetting } from './ListDialogFields';
import { PollSettingsFields } from './PollSettingsFields';
import { PollTextField } from './PollTextField';
import { ChecklistFields, ChecklistTextField } from './ChecklistFields';
import { composePoll, MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from './listComposition';
import { useListForm } from './useListForm';
import type { ListFormValues } from './listFormSchema';
import overlays from '@/components/overlays/overlays.module.css';
import dialogs from '@/components/overlays/dialogs.module.css';
import styles from './ComposerListDialog.module.css';

interface ComposerListDialogProps {
  kind: 'poll' | 'checklist';
  onClose: () => void;
  onSubmit: (message: ComposedMessage) => void | Promise<boolean>;
  initialPoll?: PollMedia;
  isPollAnonymousOnly?: boolean;
  isConnected?: boolean;
}

/** Compose a structured poll or checklist without consuming the ordinary message draft. */
export function ComposerListDialog({
  kind,
  onClose,
  onSubmit,
  initialPoll,
  isPollAnonymousOnly,
  isConnected,
}: ComposerListDialogProps) {
  const isPoll = kind === 'poll';
  const [isOpen, setIsOpen] = useState(true);
  const [submitError, setSubmitError] = useState('');
  const isSorting = useRef(false);
  const listForm = useListForm({
    kind,
    initialPoll,
    isPollAnonymousOnly,
    isConnected,
  });
  const { form, values, changeField } = listForm;
  const {
    title,
    description,
    entries,
    settings,
    correctOptionIds,
    explanation,
    canOthersComplete,
    canOthersAppend,
  } = values;
  const titleRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasSubmitted = useRef(false);
  const filledEntries = entries.filter((entry) => entry.text.trim());
  const needsCorrectAnswer = isPoll && settings.hasCorrectAnswer;
  const canSubmit = form.formState.isValid && !form.formState.isSubmitting;
  const pollTitle = initialPoll ? 'Edit Poll' : 'New Poll';
  const entriesError = form.formState.errors.entries;
  const entryErrorMessage = entriesError?.message ?? entriesError?.root?.message;

  async function submit(submitted: ListFormValues) {
    if (hasSubmitted.current) {
      return;
    }

    const validCorrectIds = submitted.correctOptionIds.filter((id) => {
      return submitted.entries.some((entry) => entry.id === id && entry.text.trim());
    });
    // Prevent a second activation while the dialog remains mounted for its exit animation.
    hasSubmitted.current = true;
    setSubmitError('');
    let message: ComposedMessage;
    if (isPoll) {
      message = {
        text: '',
        media: composePoll({
          title: submitted.title,
          description: submitted.description,
          entries: submitted.entries,
          settings: submitted.settings,
          correctOptionIds: validCorrectIds,
          explanation: submitted.explanation,
          previousDeadline: initialPoll?.closesAt,
          isConnected,
        }),
      };
    } else {
      message = {
        text: '',
        media: {
          kind: 'checklist',
          title: submitted.title,
          items: submitted.entries.map((entry) => ({
            id: entry.id,
            text: entry.text.trim(),
            isCompleted: false,
          })),
          canOthersComplete: submitted.canOthersComplete,
          canOthersAppend: submitted.canOthersAppend,
        },
      };
    }

    try {
      const isAccepted = await onSubmit(message);
      if (isAccepted === false) {
        hasSubmitted.current = false;
        return;
      }
      setIsOpen(false);
    } catch (error) {
      hasSubmitted.current = false;
      if (!isCancelled(error)) {
        setSubmitError(error instanceof Error ? error.message : 'Unable to save the poll.');
      }
    }
  }

  return (
    <Dialog.Root
      open={isOpen}
      onEscapeKeyDown={(event) => {
        // Escape belongs to the active sort session before it can dismiss the enclosing dialog.
        if (isSorting.current) {
          event.preventDefault();
        }
      }}
      onOpenChange={({ open }) => setIsOpen(open)}
      onExitComplete={onClose}
      initialFocusEl={() => {
        if (isPoll) {
          return titleRef.current;
        }
        return titleRef.current?.form?.querySelector<HTMLInputElement>('[data-list-entry]') ?? null;
      }}
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={`${overlays.dialogPositioner} ${styles.positioner}`}>
          <Dialog.Content
            className={`${dialogs.confirmation} ${styles.dialog}`}
            data-kind={kind}
            aria-describedby={undefined}
          >
            <form className={styles.form} onSubmit={form.handleSubmit(submit)}>
              <header className={styles.header}>
                <IconButton label="Close" onClick={() => setIsOpen(false)}>
                  <X size={24} />
                </IconButton>
                <Dialog.Title>{isPoll ? pollTitle : 'New Checklist'}</Dialog.Title>
                <button className={styles.create} type="submit" disabled={!canSubmit || !isOpen}>
                  {initialPoll ? 'Save' : 'Create'}
                  <Ripple />
                </button>
              </header>
              {submitError && (
                <p className={styles.hint} role="alert">
                  {submitError}
                </p>
              )}
              <motion.div
                ref={scrollContainerRef}
                className={styles.scrollBody}
                data-list-dialog-scroll
                layoutScroll
              >
                <section className={styles.section}>
                  {isPoll ? (
                    <PollTextField
                      inputRef={titleRef}
                      label="Ask a Question"
                      value={title}
                      maxLength={MAX_TITLE_LENGTH}
                      onChange={(value) => changeField('title', value)}
                    />
                  ) : (
                    <ChecklistTextField
                      inputRef={titleRef}
                      label="Title"
                      placeholder="Title..."
                      value={title}
                      onChange={(value) => changeField('title', value)}
                    />
                  )}
                  {isPoll && (
                    <PollTextField
                      label="Description (optional)"
                      value={description}
                      maxLength={MAX_DESCRIPTION_LENGTH}
                      isMultiline
                      onChange={(value) => changeField('description', value)}
                    />
                  )}
                </section>
                <section className={styles.section}>
                  <h3>{isPoll ? 'Poll options' : 'Checklist'}</h3>
                  {isPoll ? (
                    <ListEntryFields
                      entries={entries}
                      onUpdate={listForm.updateEntry}
                      onAppend={listForm.appendEntry}
                      onRemove={listForm.removeEntry}
                      onMove={listForm.moveEntry}
                      onSortingChange={({ isDragging }) => {
                        isSorting.current = isDragging;
                      }}
                      maximum={MAX_POLL_OPTIONS}
                      maxLength={MAX_POLL_OPTION_LENGTH}
                      correctOptionIds={needsCorrectAnswer ? correctOptionIds : undefined}
                      canChooseMultiple={settings.canChooseMultiple}
                      scrollContainerRef={scrollContainerRef}
                      onCorrectAnswer={listForm.selectCorrectAnswer}
                    />
                  ) : (
                    <ChecklistFields
                      entries={entries}
                      onUpdate={listForm.updateEntry}
                      onAppend={listForm.appendEntry}
                      onRemove={listForm.removeEntry}
                    />
                  )}
                </section>
                {entryErrorMessage && filledEntries.length >= 2 && (
                  <p className={styles.hint} role="alert">
                    {entryErrorMessage}
                  </p>
                )}
                {isPoll && (
                  <p className={styles.hint}>
                    You can add {MAX_POLL_OPTIONS - filledEntries.length} more options
                    {needsCorrectAnswer && (
                      <span>
                        {initialPoll
                          ? 'Set the correct answer and optional explanation again before saving.'
                          : 'Select the correct answer above.'}
                      </span>
                    )}
                  </p>
                )}
                {isPoll ? (
                  <PollSettingsFields
                    settings={settings}
                    isPollAnonymousOnly={isPollAnonymousOnly}
                    isConnected={isConnected}
                    previousDeadline={initialPoll?.closesAt}
                    onChange={listForm.updateSettings}
                    explanation={explanation}
                    onExplanationChange={(value) => changeField('explanation', value)}
                  />
                ) : (
                  <section className={styles.section}>
                    <h3>Checklist options</h3>
                    <ListSetting
                      title="Allow Others to Mark as Done"
                      isChecked={canOthersComplete}
                      onChange={({ isChecked }) => changeField('canOthersComplete', isChecked)}
                    />
                    <ListSetting
                      title="Allow Others to Add Tasks"
                      isChecked={canOthersAppend}
                      onChange={({ isChecked }) => changeField('canOthersAppend', isChecked)}
                    />
                  </section>
                )}
              </motion.div>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
