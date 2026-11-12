import { Plus, X } from 'lucide-react';
import { useRef, type Ref } from 'react';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import { MAX_CHECKLIST_TASKS } from '@/domain/messages/media';
import { createListEntry, MAX_TITLE_LENGTH, type ListEntry } from './listComposition';
import styles from './ComposerListDialog.module.css';

interface ChecklistTextFieldProps {
  label: string;
  placeholder: string;
  value: string;
  inputRef?: Ref<HTMLInputElement>;
  onChange: (value: string) => void;
  onRemove?: () => void;
}

interface ChecklistFieldsProps {
  entries: ListEntry[];
  maxEntries?: number;
  onUpdate: (index: number, text: string) => void;
  onAppend: (entry: ListEntry) => void;
  onRemove: (index: number) => void;
}

/** Animate the placeholder separately from checklist text, without floating it above the border. */
export function ChecklistTextField({
  label,
  placeholder,
  value,
  inputRef,
  onChange,
  onRemove,
}: ChecklistTextFieldProps) {
  return (
    <div className={styles.checklistField} data-task={Boolean(onRemove)}>
      <input
        ref={inputRef}
        className={styles.checklistInput}
        data-list-entry={onRemove ? '' : undefined}
        aria-label={label}
        value={value}
        maxLength={MAX_TITLE_LENGTH}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className={styles.checklistPlaceholder} data-empty={!value} aria-hidden="true">
        {placeholder}
      </span>
      {onRemove && (
        <IconButton
          label={`Delete ${label.toLowerCase()}`}
          className={styles.checklistRemove}
          onClick={onRemove}
        >
          <X size={24} />
        </IconButton>
      )}
    </div>
  );
}

/** Keep Telegram's contiguous task rows and focus each explicitly added task. */
export function ChecklistFields({
  entries,
  maxEntries = MAX_CHECKLIST_TASKS,
  onUpdate,
  onAppend,
  onRemove,
}: ChecklistFieldsProps) {
  const inputs = useRef(new Map<string, HTMLInputElement>());

  function addTask() {
    if (entries.length >= maxEntries) {
      return;
    }

    const entry = createListEntry();
    onAppend(entry);
    // Telegram focuses the new row after it is mounted, revealing it in the scroll container.
    requestAnimationFrame(() => inputs.current.get(entry.id)?.focus());
  }

  return (
    <div className={styles.checklistEntries}>
      {entries.map((entry, index) => (
        <ChecklistTextField
          key={entry.id}
          label={`Task ${index + 1}`}
          placeholder="Task"
          value={entry.text}
          inputRef={(input) => {
            if (input) {
              inputs.current.set(entry.id, input);
            } else {
              inputs.current.delete(entry.id);
            }
          }}
          onChange={(text) => onUpdate(index, text)}
          onRemove={() => onRemove(index)}
        />
      ))}
      {entries.length < maxEntries && (
        <button type="button" className={styles.addButton} onClick={addTask}>
          <Plus size={24} />
          Add Task
          <Ripple />
        </button>
      )}
    </div>
  );
}
