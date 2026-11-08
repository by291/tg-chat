import { useGesture, type FullGestureState } from '@use-gesture/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { measureViewerGeometry } from './viewerGeometry';
import {
  panViewerGesture,
  settleViewerGesture,
  resolveViewerSwipe,
  type ViewerPointerGesture,
} from './viewerGesture';
import type { CSSProperties, MouseEvent, RefObject } from 'react';
import {
  boundViewerTransform,
  createViewerTransform,
  getViewerTransformStyle,
  getViewerWheelScale,
  VIEWER_DOUBLE_CLICK_ZOOM,
  VIEWER_QUARTER_TURN,
  VIEWER_ZOOM_INITIAL,
  VIEWER_ZOOM_STEP,
  zoomViewerAtPoint,
  type ViewerGeometry,
  type ViewerPoint,
  type ViewerSize,
  type ViewerTransform,
} from './viewerTransform';

const ZOOM_SETTLE_DELAY = 300;
const WHEEL_RELEASE_DELAY = 150;
const CONTROL_SELECTOR = 'button, input, a, [data-viewer-controls]';

interface ViewerTransformOptions {
  mediaId: string | undefined;
  mediaElementRef: RefObject<HTMLElement | null>;
  isEnabled?: boolean;
  canTransform?: boolean;
  getMediaBox?: () => ViewerSize;
  onNavigate?: (direction: -1 | 1) => void;
  onDismiss?: () => void;
}

export type ViewerTransformController = ReturnType<typeof useViewerTransform>;

function isControl(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(CONTROL_SELECTOR));
}

/** Own viewer gestures on an outer layer independently of the media's opening animation. */
export function useViewerTransform(options: ViewerTransformOptions) {
  const { mediaId, mediaElementRef, isEnabled = true, canTransform = true } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef(options);
  const transformRef = useRef(createViewerTransform());
  const geometryRef = useRef<ViewerGeometry | undefined>(undefined);
  const measuredMediaRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<ResizeObserver | undefined>(undefined);
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
  const shouldIgnoreClickRef = useRef(false);
  const isZoomModifierPressedRef = useRef(false);
  const zoomSettleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [transform, setTransform] = useState(createViewerTransform);
  const [geometry, setGeometry] = useState<ViewerGeometry | undefined>(undefined);
  const [isDragging, setIsDragging] = useState(false);
  const [isDirectWheelGesture, setIsDirectWheelGesture] = useState(false);

  function updateTransform(nextTransform: ViewerTransform) {
    transformRef.current = nextTransform;
    setTransform(nextTransform);
  }

  function cancelZoomSettle() {
    clearTimeout(zoomSettleTimerRef.current);
    zoomSettleTimerRef.current = undefined;
  }

  function cancelGesture() {
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
    setIsDirectWheelGesture(false);
  }

  function measureMedia() {
    const mediaElement = mediaElementRef.current;
    const container = containerRef.current;
    if (!mediaElement || !container) {
      return;
    }

    if (measuredMediaRef.current !== mediaElement) {
      observerRef.current?.disconnect();
      observerRef.current?.observe(mediaElement);
      measuredMediaRef.current = mediaElement;
    }

    const nextGeometry = measureViewerGeometry({
      container,
      mediaElement,
      getMediaBox: optionsRef.current.getMediaBox,
    });

    geometryRef.current = nextGeometry;
    setGeometry(nextGeometry);
    updateTransform(
      boundViewerTransform({ geometry: nextGeometry, transform: transformRef.current }),
    );
  }

  function setZoom(scale: number, point?: ViewerPoint) {
    const currentGeometry = geometryRef.current;
    if (!isEnabled || !canTransform || !currentGeometry) {
      return;
    }

    // Slider scrubbing owns its release; an earlier wheel timeout must not interrupt it.
    cancelZoomSettle();
    setIsDirectWheelGesture(false);
    const anchor = point ?? {
      left: currentGeometry.viewport.width / 2,
      top: currentGeometry.viewport.height / 2,
    };
    updateTransform(
      zoomViewerAtPoint({
        geometry: currentGeometry,
        transform: transformRef.current,
        scale,
        point: anchor,
      }),
    );
  }

  function resetZoom() {
    cancelZoomSettle();
    setIsDirectWheelGesture(false);
    updateTransform({
      ...createViewerTransform(),
      rotation: transformRef.current.rotation,
    });
  }

  function finishZoomGesture() {
    cancelZoomSettle();
    setIsDirectWheelGesture(false);
    if (isEnabled && canTransform && transformRef.current.scale < VIEWER_ZOOM_INITIAL) {
      resetZoom();
    }
  }

  function scheduleZoomSettle(delay = ZOOM_SETTLE_DELAY) {
    cancelZoomSettle();
    zoomSettleTimerRef.current = setTimeout(finishZoomGesture, delay);
  }

  function zoomIn() {
    setZoom(transformRef.current.scale + VIEWER_ZOOM_STEP);
    scheduleZoomSettle();
  }

  function zoomOut() {
    setZoom(transformRef.current.scale - VIEWER_ZOOM_STEP);
    scheduleZoomSettle();
  }

  function toggleZoom() {
    if (!isEnabled || !canTransform) {
      return;
    }

    if (transformRef.current.scale !== VIEWER_ZOOM_INITIAL) {
      resetZoom();
      return;
    }

    zoomIn();
  }

  function rotateCounterclockwise() {
    setIsDirectWheelGesture(false);
    const currentGeometry = geometryRef.current;
    if (!isEnabled || !canTransform || !currentGeometry) {
      return;
    }

    updateTransform(
      boundViewerTransform({
        geometry: currentGeometry,
        transform: {
          ...transformRef.current,
          rotation: transformRef.current.rotation - VIEWER_QUARTER_TURN,
        },
      }),
    );
  }

  function consumeGestureClick() {
    const shouldIgnoreClick = shouldIgnoreClickRef.current;
    shouldIgnoreClickRef.current = false;
    return shouldIgnoreClick;
  }

  function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (!isEnabled || !canTransform || isControl(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (transformRef.current.scale !== VIEWER_ZOOM_INITIAL) {
      resetZoom();
      return;
    }

    setZoom(VIEWER_DOUBLE_CLICK_ZOOM, { left: event.clientX, top: event.clientY });
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (consumeGestureClick()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onDrag(state: FullGestureState<'drag'>) {
    const { event, first, last, canceled, cancel, movement, xy, pinching } = state;
    if (first) {
      const pointerType = 'pointerType' in event ? event.pointerType : 'touch';
      const canStart =
        isEnabled &&
        !isControl(event.target) &&
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
        origin: { left: xy[0], top: xy[1] },
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
    if (canceled || event.type === 'pointercancel' || event.type === 'touchcancel') {
      gestureRef.current = undefined;
      setIsDragging(false);
      return;
    }
    if (pinching || pinchRef.current) {
      gesture.hasPinched = true;
      gesture.lastDragOffset = { left: movement[0], top: movement[1] };
      return;
    }

    const point =
      'clientX' in event
        ? { left: event.clientX, top: event.clientY }
        : { left: xy[0], top: xy[1] };
    if (dispatchTouchSwipe(point, gesture)) {
      shouldIgnoreClickRef.current = true;
      cancelGesture();
      return;
    }
    if (last) {
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
    const { event, first, last, canceled, cancel, origin, movement } = state;
    if (first) {
      if (!isEnabled || !canTransform || isControl(event.target)) {
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
    if (last || canceled) {
      pinchRef.current = undefined;
      pinchCancelRef.current = undefined;
      setIsDragging(false);
      if (!canceled && transformRef.current.scale < VIEWER_ZOOM_INITIAL) {
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
    if (isEnabled && !isControl(event.target)) {
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
      cancelGesture();
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
      optionsRef.current.onDismiss?.();
    } else {
      optionsRef.current.onNavigate?.(action === 'next' ? 1 : -1);
    }
    return true;
  }

  function onWheel(event: WheelEvent) {
    const currentGeometry = geometryRef.current;
    if (!isEnabled || !canTransform || !currentGeometry || isControl(event.target)) {
      return;
    }

    event.preventDefault();
    const current = transformRef.current;
    // Safari reports its trackpad smart-zoom gesture as control-wheel with two negative zeros.
    const isSmartZoom = event.ctrlKey && Object.is(event.deltaX, -0) && Object.is(event.deltaY, -0);
    if (isSmartZoom) {
      const scale =
        current.scale === VIEWER_ZOOM_INITIAL ? VIEWER_DOUBLE_CLICK_ZOOM : VIEWER_ZOOM_INITIAL;
      setZoom(scale, { left: event.clientX, top: event.clientY });
      scheduleZoomSettle();
      return;
    }

    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      setZoom(getViewerWheelScale({ scale: current.scale, deltaY: event.deltaY }), {
        left: event.clientX,
        top: event.clientY,
      });
      // Pinch synthesizes ctrl-wheel without a physical Control key. It must track input
      // directly; only deliberate modifier-wheel steps retain the animated zoom response.
      setIsDirectWheelGesture(!isZoomModifierPressedRef.current);
      scheduleZoomSettle(WHEEL_RELEASE_DELAY);
      return;
    }

    setIsDirectWheelGesture(!isZoomModifierPressedRef.current);
    scheduleZoomSettle(WHEEL_RELEASE_DELAY);
    updateTransform(
      boundViewerTransform({
        geometry: currentGeometry,
        transform: {
          ...current,
          offsetX: current.offsetX - event.deltaX,
          offsetY: current.offsetY - event.deltaY,
        },
      }),
    );
  }

  useLayoutEffect(() => {
    const updateZoomModifier = (event: KeyboardEvent) => {
      isZoomModifierPressedRef.current = event.ctrlKey || event.metaKey;
    };
    const clearZoomModifier = () => {
      isZoomModifierPressedRef.current = false;
      cancelGesture();
    };
    window.addEventListener('keydown', updateZoomModifier);
    window.addEventListener('keyup', updateZoomModifier);
    window.addEventListener('blur', clearZoomModifier);
    return () => {
      window.removeEventListener('keydown', updateZoomModifier);
      window.removeEventListener('keyup', updateZoomModifier);
      window.removeEventListener('blur', clearZoomModifier);
    };
  }, []);

  const wheelListenerRef = useRef(onWheel);
  useLayoutEffect(() => {
    optionsRef.current = options;
    wheelListenerRef.current = onWheel;
    if (mediaElementRef.current !== measuredMediaRef.current) {
      measureMedia();
    }
  });

  useLayoutEffect(() => {
    // A busy or closing viewer must not finish a gesture that began on an earlier state.
    shouldIgnoreClickRef.current ||= Boolean(gestureRef.current);
    cancelZoomSettle();
    cancelGesture();
    if (!canTransform) {
      updateTransform(createViewerTransform());
    }
  }, [isEnabled, canTransform]);

  useLayoutEffect(() => {
    updateTransform(createViewerTransform());
    cancelZoomSettle();
    cancelGesture();
    shouldIgnoreClickRef.current = false;
    measureMedia();

    const container = containerRef.current;
    const mediaElement = mediaElementRef.current;
    const dispatchWheel = (event: WheelEvent) => wheelListenerRef.current(event);
    container?.addEventListener('wheel', dispatchWheel, { passive: false });
    window.addEventListener('resize', measureMedia);
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measureMedia);
    observerRef.current = observer;
    if (mediaElement) {
      observer?.observe(mediaElement);
    }

    return () => {
      cancelZoomSettle();
      container?.removeEventListener('wheel', dispatchWheel);
      window.removeEventListener('resize', measureMedia);
      observer?.disconnect();
      observerRef.current = undefined;
    };
  }, [mediaId, mediaElementRef]);

  const transformStyle: CSSProperties = {
    transform: geometry ? getViewerTransformStyle({ geometry, transform }) : undefined,
    transformOrigin: '0 0',
    touchAction: 'none',
    transition: isDragging || isDirectWheelGesture ? 'none' : undefined,
  };

  return {
    containerRef,
    transformStyle,
    transform,
    scale: transform.scale,
    rotation: transform.rotation,
    isZooming: transform.scale !== VIEWER_ZOOM_INITIAL,
    isDragging,
    gestureProps: {
      ...bindGestures(),
      onDoubleClick,
      onClickCapture,
    },
    zoomIn,
    zoomOut,
    toggleZoom,
    resetZoom,
    finishZoomGesture,
    setZoom,
    rotateCounterclockwise,
    consumeGestureClick,
    refreshGeometry: measureMedia,
  };
}
