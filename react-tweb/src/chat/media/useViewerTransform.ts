import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent, RefObject } from 'react';
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

const SWIPE_VIEWPORT_RATIO = 0.2;
const SWIPE_DISTANCE = 125;
const PAN_VELOCITY_FACTOR = 0.1;
const PAN_IDLE_RESET_DELAY = 500;
const MIN_GESTURE_DURATION = 1;
const ZOOM_SETTLE_DELAY = 300;
const WHEEL_RELEASE_DELAY = 150;
const PRIMARY_BUTTON = 0;
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

interface PointerGesture {
  origin: ViewerPoint;
  distance: number;
  transform: ViewerTransform;
  pointerType: string;
  hasPinched: boolean;
  lastDragOffset: ViewerPoint;
  lastDragDelta: ViewerPoint;
  firstMoveTime?: number;
  lastMoveTime?: number;
}

export type ViewerTransformController = ReturnType<typeof useViewerTransform>;

function isControl(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(CONTROL_SELECTOR));
}

function getPointerCenter(points: Map<number, ViewerPoint>): ViewerPoint {
  let left = 0;
  let top = 0;
  for (const point of points.values()) {
    left += point.left;
    top += point.top;
  }

  return { left: left / points.size, top: top / points.size };
}

function getPointerDistance(points: Map<number, ViewerPoint>) {
  const [first, second] = [...points.values()];
  if (!first || !second) {
    return 0;
  }

  return Math.hypot(second.left - first.left, second.top - first.top);
}

function exceedsSwipeThreshold(distance: number, viewportLength: number) {
  return (
    Math.abs(distance) / viewportLength > SWIPE_VIEWPORT_RATIO ||
    Math.abs(distance) > SWIPE_DISTANCE
  );
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
  const pointsRef = useRef(new Map<number, ViewerPoint>());
  const pointerTargetsRef = useRef(new Map<number, Element>());
  const gestureRef = useRef<PointerGesture | undefined>(undefined);
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
    for (const [pointerId, target] of pointerTargetsRef.current) {
      if (target.hasPointerCapture?.(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    }

    pointerTargetsRef.current.clear();
    pointsRef.current.clear();
    gestureRef.current = undefined;
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

    // The layout box must exclude this layer's transform and the inner media's opening animation.
    const currentTransform = container.style.transform;
    const currentTransition = container.style.transition;
    container.style.transition = 'none';
    container.style.transform = 'none';
    const rectangle = mediaElement.getBoundingClientRect();
    container.style.transform = currentTransform;
    // Flush restoration before re-enabling transitions so measurement cannot animate from identity.
    container.getBoundingClientRect();
    container.style.transition = currentTransition;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const nextGeometry: ViewerGeometry = {
      media: {
        left: rectangle.left,
        top: rectangle.top,
        width: rectangle.width,
        height: rectangle.height,
      },
      viewport,
      mediaBox: optionsRef.current.getMediaBox?.() ?? viewport,
    };

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

  function startGesture(pointerType: string) {
    gestureRef.current = {
      origin: getPointerCenter(pointsRef.current),
      distance: getPointerDistance(pointsRef.current),
      transform: transformRef.current,
      pointerType,
      hasPinched: pointsRef.current.size > 1 || Boolean(gestureRef.current?.hasPinched),
      lastDragOffset: { left: 0, top: 0 },
      lastDragDelta: { left: 0, top: 0 },
    };
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const canStartGesture =
      isEnabled &&
      (canTransform || event.pointerType === 'touch') &&
      event.button === PRIMARY_BUTTON &&
      !isControl(event.target);
    if (!canStartGesture) {
      return;
    }

    shouldIgnoreClickRef.current = false;
    const isFittedMousePress =
      event.pointerType !== 'touch' && transformRef.current.scale === VIEWER_ZOOM_INITIAL;
    // Fitted photos have no mouse-pan action. Small pointer movement must remain a click.
    if (isFittedMousePress) {
      return;
    }

    cancelZoomSettle();
    setIsDirectWheelGesture(false);
    pointsRef.current.set(event.pointerId, { left: event.clientX, top: event.clientY });
    // Capture on the media target so a stationary tap keeps its original click destination.
    if (event.target instanceof Element) {
      event.target.setPointerCapture?.(event.pointerId);
      pointerTargetsRef.current.set(event.pointerId, event.target);
    }
    startGesture(event.pointerType);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    const currentGeometry = geometryRef.current;
    if (!isEnabled || !gesture || !pointsRef.current.has(event.pointerId)) {
      return;
    }

    pointsRef.current.set(event.pointerId, { left: event.clientX, top: event.clientY });
    const center = getPointerCenter(pointsRef.current);
    const offsetX = center.left - gesture.origin.left;
    const offsetY = center.top - gesture.origin.top;
    const hasDragged = offsetX !== 0 || offsetY !== 0;
    const isPinching = pointsRef.current.size > 1 && gesture.distance > 0;
    shouldIgnoreClickRef.current ||= hasDragged || isPinching;
    if (!hasDragged && !isPinching) {
      return;
    }

    event.preventDefault();
    setIsDragging(true);
    if (dispatchTouchSwipe(event, gesture)) {
      cancelGesture();
      return;
    }

    if (!canTransform || !currentGeometry) {
      return;
    }

    if (isPinching) {
      const scale =
        (gesture.transform.scale * getPointerDistance(pointsRef.current)) / gesture.distance;
      const zoomed = zoomViewerAtPoint({
        geometry: currentGeometry,
        transform: gesture.transform,
        scale,
        point: gesture.origin,
      });
      updateTransform(
        boundViewerTransform({
          geometry: currentGeometry,
          transform: {
            ...zoomed,
            offsetX: zoomed.offsetX + offsetX,
            offsetY: zoomed.offsetY + offsetY,
          },
        }),
      );
      return;
    }

    panPointerGesture(gesture, { left: offsetX, top: offsetY });
  }

  function panPointerGesture(gesture: PointerGesture, offset: ViewerPoint) {
    const currentGeometry = geometryRef.current;
    if (!currentGeometry) {
      return;
    }

    const currentTime = Date.now();
    gesture.firstMoveTime ??= currentTime;
    if (
      gesture.lastMoveTime !== undefined &&
      currentTime >= gesture.lastMoveTime + PAN_IDLE_RESET_DELAY
    ) {
      gesture.firstMoveTime = gesture.lastMoveTime + PAN_IDLE_RESET_DELAY;
    }
    gesture.lastMoveTime = currentTime;
    gesture.lastDragDelta = {
      left: offset.left - gesture.lastDragOffset.left,
      top: offset.top - gesture.lastDragOffset.top,
    };
    gesture.lastDragOffset = offset;
    const currentTransform = transformRef.current;

    // Accumulate from the bounded position so reversing an edge drag responds immediately.
    updateTransform(
      boundViewerTransform({
        geometry: currentGeometry,
        transform: {
          ...currentTransform,
          offsetX: currentTransform.offsetX + gesture.lastDragDelta.left,
          offsetY: currentTransform.offsetY + gesture.lastDragDelta.top,
        },
      }),
    );
  }

  function settlePointerTransform(gesture: PointerGesture) {
    const currentGeometry = geometryRef.current;
    const currentTransform = transformRef.current;
    if (!isEnabled || !canTransform || !currentGeometry) {
      return;
    }

    if (currentTransform.scale < VIEWER_ZOOM_INITIAL) {
      resetZoom();
      return;
    }

    const canApplyMomentum =
      !gesture.hasPinched &&
      currentTransform.scale > VIEWER_ZOOM_INITIAL &&
      gesture.transform.scale === currentTransform.scale;
    if (
      !canApplyMomentum ||
      gesture.firstMoveTime === undefined ||
      gesture.lastMoveTime === undefined
    ) {
      return;
    }

    const currentTime = Date.now();
    const idleResetTime = gesture.lastMoveTime + PAN_IDLE_RESET_DELAY;
    const gestureTime = currentTime >= idleResetTime ? idleResetTime : gesture.firstMoveTime;
    const elapsedTime = Math.max(MIN_GESTURE_DURATION, currentTime - gestureTime);
    const distanceLeft = Math.abs(gesture.lastDragOffset.left);
    const distanceTop = Math.abs(gesture.lastDragOffset.top);
    const velocityLeft = distanceLeft / elapsedTime;
    const velocityTop = distanceTop / elapsedTime;

    // Match tweb's release momentum, then apply the same rotated-content edge bounds.
    updateTransform(
      boundViewerTransform({
        geometry: currentGeometry,
        transform: {
          ...currentTransform,
          offsetX:
            currentTransform.offsetX +
            distanceLeft * velocityLeft * PAN_VELOCITY_FACTOR * gesture.lastDragDelta.left,
          offsetY:
            currentTransform.offsetY +
            distanceTop * velocityTop * PAN_VELOCITY_FACTOR * gesture.lastDragDelta.top,
        },
      }),
    );
  }

  function dispatchTouchSwipe(event: PointerEvent<HTMLDivElement>, gesture: PointerGesture) {
    const canSwipe =
      gesture.pointerType === 'touch' &&
      gesture.transform.scale === VIEWER_ZOOM_INITIAL &&
      !gesture.hasPinched;
    if (!isEnabled || !canSwipe || event.type === 'pointercancel') {
      return false;
    }

    const offsetX = event.clientX - gesture.origin.left;
    const offsetY = event.clientY - gesture.origin.top;
    if (exceedsSwipeThreshold(offsetX, window.innerWidth)) {
      shouldIgnoreClickRef.current = true;
      optionsRef.current.onNavigate?.(offsetX < 0 ? 1 : -1);
      return true;
    }

    if (exceedsSwipeThreshold(offsetY, window.innerHeight)) {
      shouldIgnoreClickRef.current = true;
      optionsRef.current.onDismiss?.();
      return true;
    }

    return false;
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    pointsRef.current.delete(event.pointerId);
    pointerTargetsRef.current.delete(event.pointerId);
    const target = event.target;
    if (target instanceof Element && target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }

    if (event.type === 'pointercancel') {
      cancelGesture();
      return;
    }

    if (gesture) {
      settlePointerTransform(gesture);
    }

    if (pointsRef.current.size > 0) {
      startGesture(event.pointerType);
      return;
    }

    gestureRef.current = undefined;
    setIsDragging(false);
    setIsDirectWheelGesture(false);
    if (gesture) {
      dispatchTouchSwipe(event, gesture);
    }
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
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
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
