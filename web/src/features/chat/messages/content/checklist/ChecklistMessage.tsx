import { Check } from 'lucide-react';
import { useState } from 'react';
import {
  MAX_CHECKLIST_TASKS,
  MAX_CHECKLIST_TEXT_LENGTH,
  type ChecklistMedia,
} from '@/domain/messages/media';
import type { MessageInteraction } from '@/domain/messages/interaction';
import { useCurrentUserId } from '@/features/chat/CurrentUser';
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
  onInteract: (interaction: MessageInteraction) => void | Promise<boolean>;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTask, setNewTask] = useState('');
  const [isAppending, setIsAppending] = useState(false);
  const currentUserId = useCurrentUserId();
  const isOwner = message.authorId === currentUserId;
  const canComplete =
    !message.forwardedFrom && (checklist.canComplete ?? (isOwner || checklist.canOthersComplete));
  const canAppend =
    !message.forwardedFrom &&
    (checklist.canAppend ?? (isOwner || checklist.canOthersAppend)) &&
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

  useStructuredMessageAction({
    messageId: message.id,
    action: 'edit-checklist',
    onAction: () => {
      if (checklist.canEdit && !message.forwardedFrom) {
        void onInteract({ type: 'edit-checklist' });
      }
    },
  });

  function changeCompletion(task: ChecklistMedia['items'][number]) {
    if (task.version === undefined) {
      void onInteract({ type: 'toggle-task', taskId: task.id });
      return;
    }

    void onInteract({
      type: 'set-task',
      taskId: task.id,
      expectedTaskVersion: task.version,
      isComplete: !task.isCompleted,
    });
  }

  async function appendTask() {
    const text = newTask.trim();
    if (!text || isAppending || !canAppend) {
      return;
    }

    setIsAppending(true);
    try {
      const accepted = await onInteract({
        type: 'add-task',
        id: crypto.randomUUID(),
        text,
        expectedListVersion: checklist.listVersion,
      });
      if (accepted !== false) {
        setNewTask('');
        setIsAdding(false);
      }
    } finally {
      setIsAppending(false);
    }
  }

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
            onClick={() => changeCompletion(item)}
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
            void appendTask();
          }}
        >
          <input
            autoFocus
            aria-label="New task"
            placeholder="Task"
            value={newTask}
            maxLength={MAX_CHECKLIST_TEXT_LENGTH}
            disabled={isAppending}
            onChange={(event) => setNewTask(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setIsAdding(false);
              }
            }}
          />
          <button type="submit" disabled={!newTask.trim() || isAppending}>
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
