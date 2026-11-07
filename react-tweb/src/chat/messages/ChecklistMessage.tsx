import { Check, Plus } from 'lucide-react';
import { useState } from 'react';
import {
  MAX_CHECKLIST_TASKS,
  MAX_CHECKLIST_TEXT_LENGTH,
  type ChecklistMedia,
} from '../messageMedia';
import type { MessageInteraction } from '../messageInteraction';
import { CURRENT_USER_ID, type Message } from '../model';
import styles from './MessageBody.module.css';

/** Keep checklist completion and additions in persisted message state. */
export function ChecklistMessage({
  message,
  checklist,
  onInteract,
}: {
  message: Message;
  checklist: ChecklistMedia;
  onInteract: (interaction: MessageInteraction) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTask, setNewTask] = useState('');
  const isOwner = message.authorId === CURRENT_USER_ID;
  const canComplete = isOwner || checklist.canOthersComplete;
  const canAppend =
    (isOwner || checklist.canOthersAppend) && checklist.items.length < MAX_CHECKLIST_TASKS;
  const completedCount = checklist.items.filter((item) => item.isCompleted).length;

  return (
    <section className={styles.poll} aria-label={checklist.title}>
      <strong>{checklist.title}</strong>
      <small>Checklist</small>
      <div className={styles.pollOptions}>
        {checklist.items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="checkbox"
            aria-checked={item.isCompleted}
            disabled={!canComplete}
            className={styles.checklistTask}
            onClick={() => onInteract({ type: 'toggle-task', taskId: item.id })}
          >
            <span className={styles.pollChoice} data-completed={item.isCompleted}>
              {item.isCompleted && <Check size={14} />}
            </span>
            <span>{item.text}</span>
          </button>
        ))}
      </div>
      {canAppend && (
        <button type="button" className={styles.pollAction} onClick={() => setIsAdding(!isAdding)}>
          <Plus size={18} /> Add Task
        </button>
      )}
      {isAdding && canAppend && (
        <form
          className={styles.appendForm}
          onSubmit={(event) => {
            event.preventDefault();
            const text = newTask.trim();
            if (!text) {
              return;
            }
            onInteract({ type: 'add-task', id: crypto.randomUUID(), text });
            setNewTask('');
            setIsAdding(false);
          }}
        >
          <input
            aria-label="New task"
            placeholder="Task"
            value={newTask}
            maxLength={MAX_CHECKLIST_TEXT_LENGTH}
            onChange={(event) => setNewTask(event.target.value)}
          />
          <button type="submit" disabled={!newTask.trim()}>
            Add
          </button>
        </form>
      )}
      <small>
        {completedCount} of {checklist.items.length} completed
      </small>
    </section>
  );
}
