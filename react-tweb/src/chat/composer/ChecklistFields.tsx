import { Plus, X } from 'lucide-react';
import { useRef, type Ref } from 'react';
import { IconButton } from '../../components/IconButton';
import { Ripple } from '../../components/Ripple';
import { MAX_CHECKLIST_TASKS } from '../messageMedia';
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
  onChange: (entries: ListEntry[]) => void;
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
export function ChecklistFields({ entries, onChange }: ChecklistFieldsProps) {
  const inputs = useRef(new Map<string, HTMLInputElement>());

  function addTask() {
    if (entries.length >= MAX_CHECKLIST_TASKS) {
      return;
    }
    const entry = createListEntry();
    onChange([...entries, entry]);
    // Telegram focuses the new row after it is mounted, revealing it in the scroll container.
    requestAnimationFrame(() => inputs.current.get(entry.id)?.focus());
  }

  function updateTask(id: string, text: string) {
    const nextEntries = entries.map((entry) => {
      return entry.id === id ? { ...entry, text } : entry;
    });
    onChange(nextEntries);
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
          onChange={(text) => updateTask(entry.id, text)}
          onRemove={() => onChange(entries.filter((item) => item.id !== entry.id))}
        />
      ))}
      {entries.length < MAX_CHECKLIST_TASKS && (
        <button type="button" className={styles.addButton} onClick={addTask}>
          <Plus size={24} />
          Add Task
          <Ripple />
        </button>
      )}
    </div>
  );
}
