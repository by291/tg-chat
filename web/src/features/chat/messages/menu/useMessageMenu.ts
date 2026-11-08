import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { findMessageRow } from '../selection/messageRowTarget';
import type { MessageMenuTarget } from './MessageMenu';

const LONG_PRESS_DURATION_MS = 700;
const LONG_PRESS_MOVE_TOLERANCE = 10;

interface MessageMenuOptions {
  viewportRef: RefObject<HTMLDivElement | null>;
  isDisabled?: boolean;
  selectedIds?: string[];
  onSelectMessage: (messageId: string) => void;
}

function findMessageTarget(element: EventTarget | null): MessageMenuTarget | undefined {
  if (!(element instanceof Element)) {
    return undefined;
  }
  const row = findMessageRow(element);
  const messageId = row?.dataset.messageId;
  if (!row || !messageId) {
    return undefined;
  }
  // Keyboard menus anchor to the content; pointer menus use the actual press coordinates.
  const content = row.querySelector<HTMLElement>('[data-message-content]');
  const rectangle = (content ?? row).getBoundingClientRect();
  return {
    messageId,
    row,
    point: { x: rectangle.left, y: rectangle.bottom },
  };
}

/** Delegate message-menu entry points without creating a menu controller in every bubble. */
export function useMessageMenu({
  viewportRef,
  isDisabled,
  selectedIds,
  onSelectMessage,
}: MessageMenuOptions) {
  const contentId = useId();
  const [target, setTarget] = useState<MessageMenuTarget>();
  const [isOpen, setIsOpen] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointerStartRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const hasLongPressedRef = useRef(false);
  const lastPointerTypeRef = useRef('mouse');

  const cancelLongPress = useCallback(() => {
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = undefined;
    pointerStartRef.current = undefined;
  }, []);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    cancelLongPress();
  }, [cancelLongPress]);

  const releaseTarget = useCallback((exitingTarget?: MessageMenuTarget) => {
    // An old exit animation may finish after another message has opened its menu.
    // Release only its own DOM reference, never the newly opened target.
    setTarget((current) => (current === exitingTarget ? undefined : current));
  }, []);

  function openMenu(nextTarget: MessageMenuTarget) {
    if (isDisabled) {
      return;
    }
    // Freeze the menu mode through its exit animation when Select changes the timeline state.
    setTarget({ ...nextTarget, selectedIds });
    setIsOpen(true);
  }

  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    const nextTarget = findMessageTarget(event.target);
    if (!nextTarget || isDisabled) {
      return;
    }
    event.preventDefault();
    if (lastPointerTypeRef.current === 'touch') {
      return;
    }
    cancelLongPress();
    openMenu({ ...nextTarget, point: { x: event.clientX, y: event.clientY } });
  }

  function onClick(event: MouseEvent<HTMLDivElement>) {
    if (hasLongPressedRef.current) {
      hasLongPressedRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const element = event.target;
    if (!(element instanceof Element)) {
      return;
    }
    const isTouchTap = lastPointerTypeRef.current === 'touch' && selectedIds === undefined;
    const isInteractiveContent = Boolean(
      element.closest('button, a, input, video, audio, [data-message-media]'),
    );
    if (!isTouchTap || isInteractiveContent) {
      return;
    }
    const nextTarget = findMessageTarget(element);
    if (nextTarget) {
      event.preventDefault();
      event.stopPropagation();
      const point = { x: event.clientX, y: event.clientY };
      openMenu({ ...nextTarget, point });
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const isContextShortcut =
      event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    if (!isContextShortcut) {
      return;
    }
    const nextTarget = findMessageTarget(event.target);
    if (nextTarget) {
      event.preventDefault();
      openMenu(nextTarget);
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    cancelLongPress();
    lastPointerTypeRef.current = event.pointerType;
    hasLongPressedRef.current = false;
    if (isDisabled || event.pointerType !== 'touch' || selectedIds !== undefined) {
      return;
    }
    const nextTarget = findMessageTarget(event.target);
    if (!nextTarget) {
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    pointerStartRef.current = point;
    longPressTimerRef.current = setTimeout(() => {
      hasLongPressedRef.current = true;
      // A hold selects; its release must not immediately toggle the new selection off.
      onSelectMessage(nextTarget.messageId);
      cancelLongPress();
    }, LONG_PRESS_DURATION_MS);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStartRef.current;
    if (!start) {
      return;
    }
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance > LONG_PRESS_MOVE_TOLERANCE) {
      cancelLongPress();
    }
  }

  // A virtual row can disappear without a user click. Never leave actions targeting a detached row.
  useLayoutEffect(() => {
    if (isOpen && (!target?.row.isConnected || isDisabled)) {
      closeMenu();
    }
  });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    // A point-anchored menu must close as the underlying messages move, including programmatic
    // jumps.
    viewport.addEventListener('scroll', closeMenu, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', closeMenu);
      cancelLongPress();
    };
  }, [viewportRef, closeMenu, cancelLongPress]);

  return {
    contentId,
    target,
    isOpen,
    closeMenu,
    releaseTarget,
    onContextMenu,
    onClick,
    onKeyDown,
    onPointerDown,
    onPointerMove,
    cancelLongPress,
  };
}
