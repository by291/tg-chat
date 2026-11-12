import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';
import { findMessageRow } from '../messages/selection/messageRowTarget';

const AXIS_LOCK_DISTANCE = 10;
const REPLY_DISTANCE = 48;
const MAX_SWIPE_DISTANCE = 64;
const SWIPE_TEXT = '[data-message-text]:not(:has(pre))';
const REPLY_CONTROL =
  'button, a, input, select, textarea, video, audio, [data-message-media], [data-message-metadata]';

interface Swipe {
  row: HTMLElement;
  messageId: string;
  pointerId: number;
  startX: number;
  startY: number;
  direction: number;
  isActive: boolean;
}

interface ReplySwipeOptions {
  isDisabled: boolean;
  onReply: (messageId: string) => void;
}

/** Keep reply gestures away from controls and native text selection. */
export function canReplyFromTarget(target: EventTarget | null): target is Element {
  return (
    target instanceof Element &&
    !target.closest(REPLY_CONTROL) &&
    !window.getSelection()?.toString().trim()
  );
}

/** Translate only the active row and resolve a touch reply on release. */
export function useReplySwipe({ isDisabled, onReply }: ReplySwipeOptions) {
  const swipeRef = useRef<Swipe | undefined>(undefined);
  const shouldSuppressClickRef = useRef(false);

  const clearSwipe = useCallback(() => {
    const swipe = swipeRef.current;
    swipeRef.current = undefined;
    if (!swipe?.isActive) {
      return;
    }

    // A synthetic click after a drag would reopen the touch message menu.
    shouldSuppressClickRef.current = true;
    delete swipe.row.dataset.replySwiping;
    swipe.row.style.removeProperty('--reply-swipe-offset');
    swipe.row.style.removeProperty('--reply-swipe-opacity');
  }, []);

  useEffect(() => {
    if (isDisabled) {
      clearSwipe();
    }
  }, [clearSwipe, isDisabled]);

  useEffect(() => {
    window.addEventListener('blur', clearSwipe);
    return () => {
      window.removeEventListener('blur', clearSwipe);
      clearSwipe();
    };
  }, [clearSwipe]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    clearSwipe();
    if (!event.isPrimary) {
      return;
    }

    shouldSuppressClickRef.current = false;
    if (isDisabled || event.pointerType !== 'touch' || !canReplyFromTarget(event.target)) {
      return;
    }

    const row = findMessageRow(event.target);
    const messageId = row?.dataset.messageId;
    if (!row || !messageId || !row.hasAttribute('data-can-swipe-reply')) {
      return;
    }
    // Media, code blocks, and other controls keep their own native gestures.
    if (!event.target.closest(SWIPE_TEXT)) {
      return;
    }

    const direction = window.getComputedStyle(row).direction === 'rtl' ? 1 : -1;
    swipeRef.current = {
      row,
      messageId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      direction,
      isActive: false,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): boolean {
    const swipe = swipeRef.current;
    if (swipe?.pointerId !== event.pointerId) {
      return false;
    }
    if (isDisabled || !swipe.row.isConnected) {
      clearSwipe();
      return false;
    }

    const horizontal = (event.clientX - swipe.startX) * swipe.direction;
    const vertical = Math.abs(event.clientY - swipe.startY);
    if (!swipe.isActive) {
      if (Math.max(Math.abs(horizontal), vertical) < AXIS_LOCK_DISTANCE) {
        return false;
      }
      if (horizontal <= vertical) {
        clearSwipe();
        return false;
      }

      swipe.isActive = true;
      swipe.row.dataset.replySwiping = 'true';
    }

    const distance = Math.max(0, Math.min(horizontal, MAX_SWIPE_DISTANCE));
    const progress = Math.min(distance / REPLY_DISTANCE, 1);
    swipe.row.style.setProperty('--reply-swipe-offset', `${distance * swipe.direction}px`);
    swipe.row.style.setProperty('--reply-swipe-opacity', String(progress));
    return true;
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const swipe = swipeRef.current;
    if (swipe?.pointerId !== event.pointerId) {
      return;
    }

    clearSwipe();
    const distance = (event.clientX - swipe.startX) * swipe.direction;
    const canReply =
      swipe.isActive &&
      !isDisabled &&
      swipe.row.isConnected &&
      swipe.row.hasAttribute('data-can-swipe-reply') &&
      !window.getSelection()?.toString().trim();
    if (canReply && distance >= REPLY_DISTANCE) {
      onReply(swipe.messageId);
    }
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (swipeRef.current?.pointerId === event.pointerId) {
      clearSwipe();
    }
  }

  function onClick(event: MouseEvent<HTMLDivElement>) {
    if (event.detail > 0 && shouldSuppressClickRef.current) {
      shouldSuppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClick, clearSwipe };
}
