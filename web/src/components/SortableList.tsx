import { DragDropProvider } from '@dnd-kit/react';
import { isSortableOperation } from '@dnd-kit/react/sortable';
import { useEffect, useRef, type ReactNode } from 'react';

export interface SortMove {
  sourceId: string;
  targetIndex: number;
}

interface SortableListProps {
  children: ReactNode;
  onMove: (move: SortMove) => void;
  onDraggingChange?: (options: { isDragging: boolean }) => void;
}

/** Commit a sortable session only after a valid drop, leaving cancellation free of state writes. */
export function SortableList({ children, onMove, onDraggingChange }: SortableListProps) {
  const focusFrame = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (focusFrame.current !== undefined) {
        cancelAnimationFrame(focusFrame.current);
      }
    },
    [],
  );

  return (
    <DragDropProvider
      onBeforeDragStart={() => onDraggingChange?.({ isDragging: true })}
      onDragEnd={(event) => {
        onDraggingChange?.({ isDragging: false });

        const sourceHandle = event.operation.source?.handle;
        if (
          event.operation.activatorEvent instanceof KeyboardEvent &&
          sourceHandle instanceof HTMLElement
        ) {
          // React commits the new order before returning focus to the same logical item's handle.
          focusFrame.current = requestAnimationFrame(() => {
            if (sourceHandle.isConnected) {
              sourceHandle.focus({ preventScroll: true });
            }
          });
        }

        if (event.canceled || !isSortableOperation(event.operation)) {
          return;
        }

        const { source, target } = event.operation;
        if (!source || !target || source.initialIndex === source.index) {
          return;
        }

        onMove({ sourceId: String(source.id), targetIndex: source.index });
      }}
    >
      {children}
    </DragDropProvider>
  );
}
