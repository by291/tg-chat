import { MAX_POLL_OPTIONS, MAX_POLL_OPTION_LENGTH } from '../messageMedia';
import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { Ripple } from '../../components/Ripple';
import type { ComposedMessage } from './MessageComposer';
import { ListEntryFields, ListSetting } from './ListDialogFields';
import { PollSettingsFields } from './PollSettingsFields';
import { PollTextField } from './PollTextField';
import { ChecklistFields, ChecklistTextField } from './ChecklistFields';
import {
  composePoll,
  createListEntry,
  INITIAL_POLL_SETTINGS,
  MIN_POLL_OPTIONS,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  type PollSettings,
} from './listComposition';
import overlays from '../overlays.module.css';
import dialogs from '../sidebar/ConversationDialogs.module.css';
import styles from './ComposerListDialog.module.css';

interface ComposerListDialogProps {
  kind: 'poll' | 'checklist';
  onClose: () => void;
  onSubmit: (message: ComposedMessage) => void;
}

/** Compose a structured poll or checklist without consuming the ordinary message draft. */
export function ComposerListDialog({ kind, onClose, onSubmit }: ComposerListDialogProps) {
  const isPoll = kind === 'poll';
  const [isOpen, setIsOpen] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [entries, setEntries] = useState(() => {
    return Array.from({ length: isPoll ? MIN_POLL_OPTIONS : 1 }, createListEntry);
  });
  const [settings, setSettings] = useState(INITIAL_POLL_SETTINGS);
  const [correctOptionIds, setCorrectOptionIds] = useState<string[]>([]);
  const [explanation, setExplanation] = useState('');
  const [canOthersComplete, setCanOthersComplete] = useState(false);
  const [canOthersAppend, setCanOthersAppend] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasSubmitted = useRef(false);
  const filledEntries = entries.filter((entry) => entry.text.trim());
  const validCorrectIds = correctOptionIds.filter((id) => {
    return filledEntries.some((entry) => entry.id === id);
  });
  const hasEnoughItems = filledEntries.length >= (isPoll ? MIN_POLL_OPTIONS : 1);
  const hasValidChecklist = isPoll || filledEntries.length === entries.length;
  const needsCorrectAnswer = isPoll && settings.hasCorrectAnswer;
  const hasCorrectAnswer = !needsCorrectAnswer || validCorrectIds.length > 0;
  const hasDuplicateOptions =
    isPoll && new Set(filledEntries.map((entry) => entry.text)).size !== filledEntries.length;
  const canSubmit =
    Boolean(title.trim()) &&
    hasEnoughItems &&
    hasValidChecklist &&
    hasCorrectAnswer &&
    !hasDuplicateOptions;

  function updateSettings(next: PollSettings) {
    setSettings(next);
    if (!next.canChooseMultiple) {
      setCorrectOptionIds((current) => current.slice(0, 1));
    }
  }

  function selectCorrectAnswer(id: string) {
    setCorrectOptionIds((current) => {
      if (!settings.canChooseMultiple) {
        return [id];
      }
      if (current.includes(id)) {
        return current.filter((selectedId) => selectedId !== id);
      }
      return [...current, id];
    });
  }

  function submit() {
    if (!canSubmit || hasSubmitted.current) {
      return;
    }
    // Prevent a second activation while the dialog remains mounted for its exit animation.
    hasSubmitted.current = true;
    if (isPoll) {
      onSubmit({
        text: '',
        media: composePoll({
          title,
          description,
          entries,
          settings,
          correctOptionIds: validCorrectIds,
          explanation,
        }),
      });
    } else {
      onSubmit({
        text: '',
        media: {
          kind: 'checklist',
          title: title.trim(),
          items: filledEntries.map((entry) => ({
            id: entry.id,
            text: entry.text.trim(),
            isCompleted: false,
          })),
          canOthersComplete,
          canOthersAppend,
        },
      });
    }
    setIsOpen(false);
  }

  return (
    <Dialog.Root
      open={isOpen}
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
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <header className={styles.header}>
                <IconButton label="Close" onClick={() => setIsOpen(false)}>
                  <X size={24} />
                </IconButton>
                <Dialog.Title>{isPoll ? 'New Poll' : 'New Checklist'}</Dialog.Title>
                <button className={styles.create} type="submit" disabled={!canSubmit || !isOpen}>
                  Create
                  <Ripple />
                </button>
              </header>
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
                      onChange={setTitle}
                    />
                  ) : (
                    <ChecklistTextField
                      inputRef={titleRef}
                      label="Title"
                      placeholder="Title..."
                      value={title}
                      onChange={setTitle}
                    />
                  )}
                  {isPoll && (
                    <PollTextField
                      label="Description (optional)"
                      value={description}
                      maxLength={MAX_DESCRIPTION_LENGTH}
                      isMultiline
                      onChange={setDescription}
                    />
                  )}
                </section>
                <section className={styles.section}>
                  <h3>{isPoll ? 'Poll options' : 'Checklist'}</h3>
                  {isPoll ? (
                    <ListEntryFields
                      entries={entries}
                      onChange={setEntries}
                      maximum={MAX_POLL_OPTIONS}
                      maxLength={MAX_POLL_OPTION_LENGTH}
                      correctOptionIds={needsCorrectAnswer ? correctOptionIds : undefined}
                      canChooseMultiple={settings.canChooseMultiple}
                      scrollContainerRef={scrollContainerRef}
                      onCorrectAnswer={selectCorrectAnswer}
                    />
                  ) : (
                    <ChecklistFields entries={entries} onChange={setEntries} />
                  )}
                </section>
                {isPoll && (
                  <p className={styles.hint}>
                    You can add {MAX_POLL_OPTIONS - filledEntries.length} more options
                    {needsCorrectAnswer && <span>Select the correct answer above.</span>}
                  </p>
                )}
                {isPoll ? (
                  <PollSettingsFields
                    settings={settings}
                    onChange={updateSettings}
                    explanation={explanation}
                    onExplanationChange={setExplanation}
                  />
                ) : (
                  <section className={styles.section}>
                    <h3>Checklist options</h3>
                    <ListSetting
                      title="Allow Others to Mark as Done"
                      isChecked={canOthersComplete}
                      onChange={setCanOthersComplete}
                    />
                    <ListSetting
                      title="Allow Others to Add Tasks"
                      isChecked={canOthersAppend}
                      onChange={setCanOthersAppend}
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
