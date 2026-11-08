import { Check } from 'lucide-react';
import { useState } from 'react';
import {
  MAX_CHECKLIST_TASKS,
  MAX_CHECKLIST_TEXT_LENGTH,
  type ChecklistMedia,
} from '@/domain/messages/media';
import type { MessageInteraction } from '@/domain/messages/interaction';
import { CURRENT_USER_ID } from '@/domain/identity';
import { type Message } from '@/domain/messages/message';
import { MessageCheckbox } from '../../selection/MessageCheckbox';
import { ChecklistCelebration } from './ChecklistCelebration';
import { useStructuredMessageAction } from '../../StructuredMessageActions';
import styles from './ChecklistMessage.module.css';

/** Render task completion separately from polls, retaining the completing person's identity. */
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
  const canComplete = !message.forwardedFrom && (isOwner || checklist.canOthersComplete);
  const canAppend =
    !message.forwardedFrom &&
    (isOwner || checklist.canOthersAppend) &&
    checklist.items.length < MAX_CHECKLIST_TASKS;
  const completedCount = checklist.items.filter((item) => item.isCompleted).length;

  useStructuredMessageAction({
    messageId: message.id,
    action: 'add-task',
    onAction: () => {
      if (canAppend) {
        setIsAdding(true);
      }
    },
  });

  return (
    <section className={styles.checklist} aria-label={checklist.title}>
      <ChecklistCelebration isCompleted={completedCount === checklist.items.length} />
      <strong className={styles.title}>{checklist.title}</strong>
      <span className={styles.subtitle}>
        {checklist.canOthersComplete ? 'Group Checklist' : 'Checklist'}
      </span>
      <div className={styles.tasks}>
        {checklist.items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="checkbox"
            aria-label={item.text}
            aria-checked={item.isCompleted}
            aria-description={
              item.isCompleted && item.completedBy
                ? `Completed by ${item.completedBy.name}`
                : undefined
            }
            aria-readonly={!canComplete}
            disabled={!canComplete}
            className={styles.task}
            data-completed={item.isCompleted}
            data-readonly={!canComplete}
            onClick={() => onInteract({ type: 'toggle-task', taskId: item.id })}
          >
            {canComplete ? (
              <span className={styles.checkbox}>
                <MessageCheckbox isChecked={item.isCompleted} />
                <span
                  className={styles.avatar}
                  data-visible={item.isCompleted && Boolean(item.completedBy)}
                  aria-hidden="true"
                >
                  {item.completedBy?.name.slice(0, 1)}
                </span>
              </span>
            ) : (
              <span className={styles.readonlyIcon} aria-hidden="true">
                {item.isCompleted ? <Check size={16} /> : <span className={styles.dot} />}
              </span>
            )}
            <span className={styles.taskTitle}>
              <span className={styles.taskText}>{item.text}</span>
              {checklist.canOthersComplete && item.isCompleted && item.completedBy && (
                <span className={styles.completedBy}>{item.completedBy.name}</span>
              )}
            </span>
          </button>
        ))}
      </div>
      {isAdding && canAppend && (
        <form
          className={styles.appendForm}
          onSubmit={(event) => {
            event.preventDefault();
            const text = newTask.trim();
            if (!text) {
              return;
            }
            onInteract({
              type: 'add-task',
              id: crypto.randomUUID(),
              text,
            });
            setNewTask('');
            setIsAdding(false);
          }}
        >
          <input
            autoFocus
            aria-label="New task"
            placeholder="Task"
            value={newTask}
            maxLength={MAX_CHECKLIST_TEXT_LENGTH}
            onChange={(event) => setNewTask(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setIsAdding(false);
              }
            }}
          />
          <button type="submit" disabled={!newTask.trim()}>
            Add
          </button>
          <button type="button" onClick={() => setIsAdding(false)}>
            Cancel
          </button>
        </form>
      )}
      <span className={styles.completed}>
        {completedCount} of {checklist.items.length} tasks completed
      </span>
    </section>
  );
}
