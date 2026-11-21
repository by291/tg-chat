import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import {
  finishReplyGesture,
  moveReplyGesture,
  prepareReplyGesture,
  type ReplyGesture,
} from './replyGesture';
import { attachReplyWheel } from './replyWheel';

const AXIS_LOCK_DISTANCE = 10;

interface TouchSwipe {
  gesture: ReplyGesture;
  pointerId: number;
  startX: number;
  startY: number;
}

interface ReplySwipeOptions {
  viewportRef: RefObject<HTMLDivElement | null>;
  isDisabled: boolean;
  onReply: (messageId: string) => void;
}

/** Coordinate native touch and horizontal wheel release on the currently mounted history. */
export function useReplySwipe({ viewportRef, isDisabled, onReply }: ReplySwipeOptions) {
  const touch = useRef<TouchSwipe | undefined>(undefined);
  const wheel = useRef<ReturnType<typeof attachReplyWheel> | undefined>(undefined);
  const shouldSuppressClick = useRef(false);
  const replyOnRelease = useEffectEvent(onReply);

  const clearSwipe = useCallback(() => {
    const swipe = touch.current;
    touch.current = undefined;
    if (swipe?.gesture.isActive) {
      shouldSuppressClick.current = true;
      finishReplyGesture(swipe.gesture);
    }
  }, []);

  // prettier-ignore
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || isDisabled) {
      clearSwipe();
      return;
    }

    wheel.current = attachReplyWheel(viewport, replyOnRelease);
    const cancel = () => {
      clearSwipe();
      wheel.current?.clear();
    };
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('blur', cancel);
      clearSwipe();
      wheel.current?.dispose();
      wheel.current = undefined;
    };
  }, [
    viewportRef,
    isDisabled,
    clearSwipe,
  ]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    clearSwipe();
    wheel.current?.clear();
    if (!event.isPrimary) {
      return;
    }

    shouldSuppressClick.current = false;
    if (isDisabled || event.pointerType !== 'touch') {
      return;
    }
    const gesture = prepareReplyGesture(event.target);
    if (gesture) {
      touch.current = {
        gesture,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): boolean {
    const swipe = touch.current;
    if (!swipe || swipe.pointerId !== event.pointerId) {
      return false;
    }
    const { gesture } = swipe;
    if (isDisabled || !gesture.row.isConnected) {
      clearSwipe();
      return false;
    }
    const horizontal = (event.clientX - swipe.startX) * gesture.direction;
    const vertical = Math.abs(event.clientY - swipe.startY);
    if (!gesture.isActive) {
      if (Math.max(Math.abs(horizontal), vertical) < AXIS_LOCK_DISTANCE) {
        return false;
      }
      if (horizontal <= vertical) {
        clearSwipe();
        return false;
      }
    }
    moveReplyGesture(gesture, horizontal);
    return true;
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const swipe = touch.current;
    if (!swipe || swipe.pointerId !== event.pointerId) {
      return;
    }
    touch.current = undefined;
    if (!swipe.gesture.isActive) {
      return;
    }

    // Suppress the compatibility click before it reaches the thumbnail's gallery opener.
    shouldSuppressClick.current = true;
    const distance = (event.clientX - swipe.startX) * swipe.gesture.direction;
    swipe.gesture.distance = distance;
    finishReplyGesture(swipe.gesture, isDisabled ? undefined : onReply);
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (touch.current?.pointerId === event.pointerId) {
      clearSwipe();
    }
  }

  function onClick(event: MouseEvent<HTMLDivElement>) {
    if (event.detail > 0 && shouldSuppressClick.current) {
      shouldSuppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClick,
    clearSwipe,
  };
}
