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
import type { MessageMenuTarget } from './MessageMenu';

const LONG_PRESS_DURATION_MS = 700;
const LONG_PRESS_MOVE_TOLERANCE = 10;

interface MessageMenuOptions {
  viewportRef: RefObject<HTMLDivElement | null>;
  isDisabled?: boolean;
}

function findMessageTarget(element: EventTarget | null): MessageMenuTarget | undefined {
  if (!(element instanceof Element)) {
    return undefined;
  }
  const row = element.closest<HTMLElement>('[data-message-id]');
  const trigger = row?.querySelector<HTMLButtonElement>('[data-message-menu-trigger]');
  const messageId = row?.dataset.messageId;
  if (!trigger || !messageId) {
    return undefined;
  }
  const rectangle = trigger.getBoundingClientRect();
  return {
    messageId,
    trigger,
    point: { x: rectangle.left, y: rectangle.bottom },
  };
}

/** Delegate message-menu entry points without creating a menu controller in every bubble. */
export function useMessageMenu({ viewportRef, isDisabled }: MessageMenuOptions) {
  const contentId = useId();
  const [target, setTarget] = useState<MessageMenuTarget>();
  const [isOpen, setIsOpen] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointerStartRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const hasLongPressedRef = useRef(false);

  const cancelLongPress = useCallback(() => {
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = undefined;
    pointerStartRef.current = undefined;
  }, []);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    cancelLongPress();
  }, [cancelLongPress]);

  const releaseTarget = useCallback(() => {
    // Release the DOM reference after exit, so an offscreen bubble is not retained by the menu.
    setTarget(undefined);
  }, []);

  function openMenu(nextTarget: MessageMenuTarget) {
    if (isDisabled) {
      return;
    }
    setTarget(nextTarget);
    setIsOpen(true);
  }

  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    const nextTarget = findMessageTarget(event.target);
    if (!nextTarget || isDisabled) {
      return;
    }
    event.preventDefault();
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
    if (!(element instanceof Element) || !element.closest('[data-message-menu-trigger]')) {
      return;
    }
    const nextTarget = findMessageTarget(element);
    if (nextTarget) {
      openMenu(nextTarget);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const isContextShortcut =
      event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    const isMenuButton =
      event.target instanceof Element && event.target.closest('[data-message-menu-trigger]');
    const isArrowShortcut = isMenuButton && (event.key === 'ArrowDown' || event.key === 'ArrowUp');
    if (!isContextShortcut && !isArrowShortcut) {
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
    hasLongPressedRef.current = false;
    if (isDisabled || event.pointerType !== 'touch') {
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
      openMenu({ ...nextTarget, point });
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
    if (isOpen && (!target?.trigger.isConnected || isDisabled)) {
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
