import { useGesture, type FullGestureState } from '@use-gesture/react';
import { useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
  panViewerGesture,
  settleViewerGesture,
  resolveViewerSwipe,
  type ViewerPointerGesture,
} from './viewerGesture';
import { isViewerControlTarget, type ViewerInputOwner } from './viewerInput';
import {
  boundViewerTransform,
  VIEWER_ZOOM_INITIAL,
  zoomViewerAtPoint,
  type ViewerPoint,
  type ViewerTransform,
} from './viewerTransform';

interface ViewerPointerInputOptions extends ViewerInputOwner {
  shouldIgnoreClickRef: RefObject<boolean>;
  cancelZoomSettle: () => void;
  setIsDirectWheelGesture: Dispatch<SetStateAction<boolean>>;
  setIsDragging: Dispatch<SetStateAction<boolean>>;
  resetZoom: () => void;
  onCancelGesture: () => void;
  onNavigate?: (direction: -1 | 1) => void;
  onDismiss?: () => void;
}

/** Translate pointer gestures while writing through the viewer's single transform owner. */
export function useViewerPointerInput(options: ViewerPointerInputOptions) {
  const {
    isEnabled,
    canTransform,
    transformRef,
    geometryRef,
    shouldIgnoreClickRef,
    updateTransform,
    cancelZoomSettle,
    setIsDirectWheelGesture,
    setIsDragging,
    resetZoom,
    onCancelGesture,
    onNavigate,
    onDismiss,
  } = options;
  const dragCancelRef = useRef<(() => void) | undefined>(undefined);
  const pinchCancelRef = useRef<(() => void) | undefined>(undefined);
  const pinchRef = useRef<{ origin: ViewerPoint; transform: ViewerTransform } | undefined>(
    undefined,
  );
  const gestureRef = useRef<ViewerPointerGesture | undefined>(undefined);
  const pointerPositions = useRef(new Map<number, ViewerPoint>());
  const continuation = useRef<{ pointerId: number; gesture: ViewerPointerGesture } | undefined>(
    undefined,
  );
  const hasPinched = useRef(false);

  function cancelPointerGesture() {
    // Stop the gesture recognizers before clearing their shared continuation snapshots.
    dragCancelRef.current?.();
    pinchCancelRef.current?.();
    dragCancelRef.current = undefined;
    pinchCancelRef.current = undefined;
    pinchRef.current = undefined;
    gestureRef.current = undefined;
    continuation.current = undefined;
    pointerPositions.current.clear();
    hasPinched.current = false;
    setIsDragging(false);
  }

  function onDrag(state: FullGestureState<'drag'>) {
    const {
      event,
      first: isFirst,
      last: isLast,
      canceled: isCanceled,
      cancel,
      movement,
      xy: coordinates,
      pinching: isPinching,
    } = state;
    if (isFirst) {
      const pointerType = 'pointerType' in event ? event.pointerType : 'touch';
      const canStart =
        isEnabled &&
        !isViewerControlTarget(event.target) &&
        (pointerType === 'touch' ||
          (canTransform && transformRef.current.scale !== VIEWER_ZOOM_INITIAL));
      if (!canStart) {
        cancel();
        return;
      }

      shouldIgnoreClickRef.current = false;
      cancelZoomSettle();
      setIsDirectWheelGesture(false);
      dragCancelRef.current = cancel;
      gestureRef.current = {
        origin: { left: coordinates[0], top: coordinates[1] },
        transform: transformRef.current,
        pointerType,
        hasPinched: false,
        lastDragOffset: { left: 0, top: 0 },
        lastDragDelta: { left: 0, top: 0 },
      };
    }
    const gesture = gestureRef.current;
    if (!gesture || !isEnabled) {
      return;
    }
    if (isCanceled || event.type === 'pointercancel' || event.type === 'touchcancel') {
      gestureRef.current = undefined;
      setIsDragging(false);
      return;
    }
    if (isPinching || pinchRef.current) {
      // Pinch owns the transform; keep drag progress current for the later pointer handoff.
      gesture.hasPinched = true;
      gesture.lastDragOffset = { left: movement[0], top: movement[1] };
      return;
    }

    const point =
      'clientX' in event
        ? { left: event.clientX, top: event.clientY }
        : { left: coordinates[0], top: coordinates[1] };
    if (dispatchTouchSwipe(point, gesture)) {
      shouldIgnoreClickRef.current = true;
      onCancelGesture();
      return;
    }
    if (isLast) {
      settlePointerTransform(gesture);
      gestureRef.current = undefined;
      dragCancelRef.current = undefined;
      setIsDragging(false);
      return;
    }

    const hasMoved = movement[0] !== 0 || movement[1] !== 0;
    if (hasMoved) {
      event.preventDefault();
      shouldIgnoreClickRef.current = true;
      setIsDragging(true);
      if (canTransform) {
        panPointerGesture(gesture, { left: movement[0], top: movement[1] });
      }
    }
  }

  function onPinch(state: FullGestureState<'pinch'>) {
    const {
      event,
      first: isFirst,
      last: isLast,
      canceled: isCanceled,
      cancel,
      origin,
      movement,
    } = state;
    if (isFirst) {
      if (!isEnabled || !canTransform || isViewerControlTarget(event.target)) {
        cancel();
        return;
      }

      cancelZoomSettle();
      pinchCancelRef.current = cancel;
      hasPinched.current = true;
      continuation.current = undefined;
      pinchRef.current = {
        origin: { left: origin[0], top: origin[1] },
        transform: transformRef.current,
      };
      if (gestureRef.current) {
        gestureRef.current.hasPinched = true;
      }
    }
    const pinch = pinchRef.current;
    const currentGeometry = geometryRef.current;
    if (!pinch || !currentGeometry || !isEnabled || !canTransform) {
      return;
    }
    if (isLast || isCanceled) {
      pinchRef.current = undefined;
      pinchCancelRef.current = undefined;
      setIsDragging(false);
      if (!isCanceled && transformRef.current.scale < VIEWER_ZOOM_INITIAL) {
        resetZoom();
      }
      return;
    }

    event.preventDefault();
    shouldIgnoreClickRef.current = true;
    setIsDragging(true);
    const zoomed = zoomViewerAtPoint({
      geometry: currentGeometry,
      transform: pinch.transform,
      scale: pinch.transform.scale * movement[0],
      point: pinch.origin,
    });
    updateTransform(
      boundViewerTransform({
        geometry: currentGeometry,
        transform: {
          ...zoomed,
          offsetX: zoomed.offsetX + origin[0] - pinch.origin.left,
          offsetY: zoomed.offsetY + origin[1] - pinch.origin.top,
        },
      }),
    );
  }

  function trackPointer(event: PointerEvent) {
    if (isEnabled && !isViewerControlTarget(event.target)) {
      pointerPositions.current.set(event.pointerId, { left: event.clientX, top: event.clientY });
    }
  }

  function continuePointerPan(event: PointerEvent) {
    if (!pointerPositions.current.has(event.pointerId)) {
      return;
    }

    trackPointer(event);
    const remaining = continuation.current;
    if (!isEnabled || !canTransform || remaining?.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    shouldIgnoreClickRef.current = true;
    setIsDragging(true);
    panPointerGesture(remaining.gesture, {
      left: event.clientX - remaining.gesture.origin.left,
      top: event.clientY - remaining.gesture.origin.top,
    });
  }

  function finishPointer(event: PointerEvent) {
    pointerPositions.current.delete(event.pointerId);
    if (event.type === 'pointercancel') {
      onCancelGesture();
      return;
    }
    if (pointerPositions.current.size === 0) {
      if (continuation.current) {
        settlePointerTransform(continuation.current.gesture);
      }
      continuation.current = undefined;
      hasPinched.current = false;
      setIsDragging(false);
      return;
    }
    if (!hasPinched.current || pointerPositions.current.size !== 1 || !isEnabled || !canTransform) {
      return;
    }

    // use-gesture keeps the first pointer as drag owner. Transfer only post-pinch continuation
    // here, so either finger may lift first without creating a new swipe or a position jump.
    dragCancelRef.current?.();
    gestureRef.current = undefined;
    const [pointerId, origin] = [...pointerPositions.current][0];
    continuation.current = {
      pointerId,
      gesture: {
        origin,
        transform: transformRef.current,
        pointerType: event.pointerType,
        hasPinched: true,
        lastDragOffset: { left: 0, top: 0 },
        lastDragDelta: { left: 0, top: 0 },
      },
    };
  }

  const bindGestures = useGesture(
    {
      onDrag,
      onPinch,
      onPointerDown: ({ event }) => trackPointer(event),
      onPointerMove: ({ event }) => continuePointerPan(event),
      onPointerUp: ({ event }) => finishPointer(event),
      onPointerCancel: ({ event }) => finishPointer(event),
    },
    {
      eventOptions: { passive: false },
      drag: {
        threshold: 0,
        pointer: { capture: true, keys: false },
      },
      pinch: { pinchOnWheel: false },
    },
  );

  function panPointerGesture(gesture: ViewerPointerGesture, offset: ViewerPoint) {
    const currentGeometry = geometryRef.current;
    if (!currentGeometry) {
      return;
    }

    updateTransform(
      panViewerGesture({
        gesture,
        offset,
        geometry: currentGeometry,
        transform: transformRef.current,
        now: Date.now(),
      }),
    );
  }

  function settlePointerTransform(gesture: ViewerPointerGesture) {
    const currentGeometry = geometryRef.current;
    const currentTransform = transformRef.current;
    if (!isEnabled || !canTransform || !currentGeometry) {
      return;
    }

    if (currentTransform.scale < VIEWER_ZOOM_INITIAL) {
      resetZoom();
      return;
    }

    const settledTransform = settleViewerGesture({
      gesture,
      geometry: currentGeometry,
      transform: currentTransform,
      now: Date.now(),
    });
    if (settledTransform) {
      updateTransform(settledTransform);
    }
  }

  function dispatchTouchSwipe(point: ViewerPoint, gesture: ViewerPointerGesture) {
    if (!isEnabled) {
      return false;
    }

    const action = resolveViewerSwipe({
      point,
      gesture,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    if (!action) {
      return false;
    }

    shouldIgnoreClickRef.current = true;
    if (action === 'dismiss') {
      onDismiss?.();
    } else {
      onNavigate?.(action === 'next' ? 1 : -1);
    }

    return true;
  }

  function hasActiveGesture() {
    return Boolean(gestureRef.current);
  }

  return {
    bindGestures,
    cancelPointerGesture,
    hasActiveGesture,
  };
}
