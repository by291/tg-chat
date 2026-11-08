import { arrayMove } from '@dnd-kit/helpers';
import { Feedback } from '@dnd-kit/dom';
import {
  DragDropProvider,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
} from '@dnd-kit/react';
import { GripVertical } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useCallback, type ReactNode } from 'react';
import styles from './ChatSidebar.module.css';

// Keyboard movement follows the sidebar's fixed 72px conversation rows.
const KEYBOARD_ROW_STEP = 72;
const PINNED_CONVERSATION_TYPE = 'pinned-conversation';
const SORT_SENSORS = [PointerSensor, KeyboardSensor.configure({ offset: KEYBOARD_ROW_STEP })];

interface PinnedConversationSortingProps {
  children: ReactNode;
  pinnedIds: string[];
  onReorder: (chatIds: string[]) => void;
}

interface SortableChatRowProps {
  children: ReactNode;
  id: string;
  title: string;
  isActive: boolean;
  isDisabled: boolean;
}

/** Keep sorting ready without replacing or suspending the mounted conversation viewport. */
export function PinnedConversationSorting({
  children,
  pinnedIds,
  onReorder,
}: PinnedConversationSortingProps) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <DragDropProvider
      sensors={SORT_SENSORS}
      plugins={(defaults) => [
        ...defaults.filter((plugin) => plugin !== Feedback),
        Feedback.configure({
          // Virtual rows own their DOM positions; feedback must not reparent their contents.
          feedback: 'clone',
          dropAnimation: shouldReduceMotion ? null : undefined,
          keyboardTransition: shouldReduceMotion ? null : undefined,
        }),
      ]}
      onDragEnd={(event) => {
        const { source, target } = event.operation;
        if (event.canceled || !source || !target) {
          return;
        }
        // Resolve identities against the full current list, including pinned rows outside the window.
        const sourceIndex = pinnedIds.indexOf(String(source.id));
        const targetIndex = pinnedIds.indexOf(String(target.id));
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
          return;
        }
        onReorder(arrayMove(pinnedIds, sourceIndex, targetIndex));
      }}
    >
      {children}
    </DragDropProvider>
  );
}

/** Separate the reorder handle from the conversation button and virtual positioning layer. */
export function SortableChatRow({
  children,
  id,
  title,
  isActive,
  isDisabled,
}: SortableChatRowProps) {
  const draggable = useDraggable({
    id,
    disabled: isDisabled,
    type: PINNED_CONVERSATION_TYPE,
  });
  const droppable = useDroppable({
    id,
    disabled: isDisabled,
    accept: PINNED_CONVERSATION_TYPE,
  });
  const attachRow = useCallback(
    (element: HTMLDivElement | null) => {
      draggable.ref(element);
      droppable.ref(element);
    },
    [draggable.ref, droppable.ref],
  );

  return (
    <div
      ref={attachRow}
      className={styles.sortableRow}
      data-active={isActive}
      data-drop-target={droppable.isDropTarget}
    >
      {children}
      <button
        ref={draggable.handleRef}
        type="button"
        className={styles.reorderGrip}
        aria-label={`Reorder ${title}`}
        data-sort-handle
        hidden={isDisabled}
        disabled={isDisabled}
      >
        <GripVertical size={24} />
      </button>
    </div>
  );
}
