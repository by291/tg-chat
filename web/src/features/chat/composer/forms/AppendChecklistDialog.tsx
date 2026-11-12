import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton';
import dialogs from '@/components/overlays/dialogs.module.css';
import overlays from '@/components/overlays/overlays.module.css';
import { Ripple } from '@/components/Ripple';
import { ChecklistFields } from './ChecklistFields';
import { createListEntry, type ListEntry } from './listComposition';
import styles from './ComposerListDialog.module.css';

interface AppendChecklistDialogProps {
  title: string;
  remainingTasks: number;
  onClose: () => void;
  onSubmit: (tasks: ListEntry[]) => boolean | void | Promise<boolean | void>;
}

/** Collect new tasks and keep the entries available if the append is rejected. */
export function AppendChecklistDialog({
  title,
  remainingTasks,
  onClose,
  onSubmit,
}: AppendChecklistDialogProps) {
  const [entries, setEntries] = useState(() => [createListEntry()]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submission = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const tasks = entries.flatMap((entry) => {
    const text = entry.text.trim();
    return text ? [{ ...entry, text }] : [];
  });
  const canSubmit = tasks.length > 0 && tasks.length <= remainingTasks;

  function close() {
    if (!submission.current) {
      onClose();
    }
  }

  async function save() {
    if (submission.current || !canSubmit) {
      return;
    }

    submission.current = true;
    setIsSubmitting(true);
    setError('');
    try {
      if ((await onSubmit(tasks)) !== false) {
        onClose();
        return;
      }

      setError('Could not add the tasks. Try again.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not add the tasks.');
    } finally {
      submission.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog.Root
      open
      initialFocusEl={() =>
        content.current?.querySelector<HTMLElement>('[data-list-entry]') ?? null
      }
      onOpenChange={({ open }) => {
        if (!open) {
          close();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={`${overlays.dialogPositioner} ${styles.positioner}`}>
          <Dialog.Content
            ref={content}
            className={`${dialogs.confirmation} ${styles.dialog}`}
            data-kind="checklist"
          >
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <header className={styles.header}>
                <IconButton label="Close task editor" disabled={isSubmitting} onClick={close}>
                  <X />
                </IconButton>
                <Dialog.Title>Add tasks</Dialog.Title>
                <button
                  type="submit"
                  className={styles.create}
                  disabled={isSubmitting || !canSubmit}
                >
                  Save tasks
                  <Ripple />
                </button>
              </header>
              <div className={styles.scrollBody}>
                <div className={styles.section}>
                  <Dialog.Description asChild>
                    <h3>{title}</h3>
                  </Dialog.Description>
                  <fieldset className={styles.taskEditorFields} disabled={isSubmitting}>
                    <ChecklistFields
                      entries={entries}
                      maxEntries={remainingTasks}
                      onUpdate={(index, text) => {
                        setEntries((current) =>
                          current.map((entry, row) => (row === index ? { ...entry, text } : entry)),
                        );
                      }}
                      onAppend={(entry) => setEntries((current) => [...current, entry])}
                      onRemove={(index) => {
                        setEntries((current) => current.filter((_, row) => row !== index));
                      }}
                    />
                  </fieldset>
                  {error && <p role="alert">{error}</p>}
                </div>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
