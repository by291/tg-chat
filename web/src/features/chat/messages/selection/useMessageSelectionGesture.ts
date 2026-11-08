import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';
import type { Message } from '@/domain/messages/message';
import { findMessageRow } from './messageRowTarget';

const PRIMARY_MOUSE_BUTTON = 0;
const PRIMARY_BUTTON_MASK = 1;

export interface MessageSelectionChange {
  messageIds: string[];
  shouldSelect: boolean;
}

interface SelectionGestureOptions {
  messages: Message[];
  selectedIds?: string[];
  isDisabled?: boolean;
  onSetSelection?: (change: MessageSelectionChange) => void;
  onToggleSelection?: (messageId: string) => void;
}

interface SelectionDrag {
  lastId: string;
  shouldSelect: boolean;
  hasMoved: boolean;
  hadSelection: boolean;
  visitedIds: Set<string>;
}

/** Select crossed message rows while leaving ordinary bubble text drags to the browser. */
export function useMessageSelectionGesture({
  messages,
  selectedIds,
  isDisabled,
  onSetSelection,
  onToggleSelection,
}: SelectionGestureOptions) {
  const dragRef = useRef<SelectionDrag | undefined>(undefined);
  const shouldSuppressClickRef = useRef(false);

  useEffect(() => {
    function finishDrag() {
      if (dragRef.current?.hasMoved) {
        shouldSuppressClickRef.current = true;
      }
      dragRef.current = undefined;
    }
    // The pointer can finish outside the viewport; never retain that drag into the next click.
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    window.addEventListener('blur', finishDrag);

    return () => {
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
      window.removeEventListener('blur', finishDrag);
    };
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    shouldSuppressClickRef.current = false;
    dragRef.current = undefined;
    if (isDisabled || event.button !== PRIMARY_MOUSE_BUTTON || event.pointerType !== 'mouse') {
      return;
    }

    const messageId = findMessageRow(event.target)?.dataset.messageId;
    const target = event.target as Element;
    const isBubbleContent = target.closest('[data-message-content], button, a');
    if (!messageId || (selectedIds === undefined && isBubbleContent)) {
      return;
    }

    dragRef.current = {
      lastId: messageId,
      shouldSelect: !selectedIds?.includes(messageId),
      hasMoved: false,
      hadSelection: Boolean(selectedIds?.length),
      visitedIds: new Set<string>(),
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    // A menu or another window can consume pointerup; only a held primary button owns the drag.
    const isPrimaryButtonPressed = (event.buttons & PRIMARY_BUTTON_MASK) === PRIMARY_BUTTON_MASK;
    if (!isPrimaryButtonPressed) {
      dragRef.current = undefined;
      return;
    }

    const drag = dragRef.current;
    const messageId = findMessageRow(event.target)?.dataset.messageId;
    if (!drag || !messageId) {
      return;
    }

    const isSameRow = drag.lastId === messageId;
    if (isSameRow && (drag.hasMoved || !drag.hadSelection)) {
      return;
    }

    const previousIndex = messages.findIndex((message) => message.id === drag.lastId);
    const currentIndex = messages.findIndex((message) => message.id === messageId);
    if (previousIndex < 0 || currentIndex < 0) {
      return;
    }
    // Fill the interval because fast pointer movement can skip mounted rows between events.
    const startIndex = Math.min(previousIndex, currentIndex);
    const endIndex = Math.max(previousIndex, currentIndex);
    const crossedMessages = messages.slice(startIndex, endIndex + 1);
    const messageIds: string[] = [];
    for (const message of crossedMessages) {
      if (!message.isService && !drag.visitedIds.has(message.id)) {
        messageIds.push(message.id);
        drag.visitedIds.add(message.id);
      }
    }
    if (messageIds.length) {
      onSetSelection?.({ messageIds, shouldSelect: drag.shouldSelect });
    }
    drag.lastId = messageId;
    drag.hasMoved = true;
    window.getSelection()?.removeAllRanges();
    event.preventDefault();
  }

  function onClick(event: MouseEvent<HTMLDivElement>) {
    if (shouldSuppressClickRef.current) {
      shouldSuppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (selectedIds === undefined) {
      return;
    }

    const messageId = findMessageRow(event.target)?.dataset.messageId;
    if (messageId) {
      event.preventDefault();
      event.stopPropagation();
      onToggleSelection?.(messageId);
    }
  }

  return {
    onPointerDown,
    onPointerMove,
    onClick,
  };
}
