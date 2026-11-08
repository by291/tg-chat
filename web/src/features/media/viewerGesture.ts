import {
  boundViewerTransform,
  VIEWER_ZOOM_INITIAL,
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

export interface ViewerPointerGesture {
  origin: ViewerPoint;
  transform: ViewerTransform;
  pointerType: string;
  hasPinched: boolean;
  lastDragOffset: ViewerPoint;
  lastDragDelta: ViewerPoint;
  firstMoveTime?: number;
  lastMoveTime?: number;
}

interface GestureTransformOptions {
  gesture: ViewerPointerGesture;
  geometry: ViewerGeometry;
  transform: ViewerTransform;
  now: number;
}

interface PanGestureOptions extends GestureTransformOptions {
  offset: ViewerPoint;
}

interface SwipeOptions {
  point: ViewerPoint;
  gesture: ViewerPointerGesture;
  viewport: ViewerSize;
}

function exceedsSwipeThreshold(distance: number, viewportLength: number) {
  return (
    Math.abs(distance) / viewportLength > SWIPE_VIEWPORT_RATIO ||
    Math.abs(distance) > SWIPE_DISTANCE
  );
}

/** Pan from the bounded position so reversing direction at an edge responds immediately. */
export function panViewerGesture({
  gesture,
  offset,
  geometry,
  transform,
  now,
}: PanGestureOptions): ViewerTransform {
  gesture.firstMoveTime ??= now;
  if (gesture.lastMoveTime !== undefined && now >= gesture.lastMoveTime + PAN_IDLE_RESET_DELAY) {
    gesture.firstMoveTime = gesture.lastMoveTime + PAN_IDLE_RESET_DELAY;
  }
  gesture.lastMoveTime = now;
  gesture.lastDragDelta = {
    left: offset.left - gesture.lastDragOffset.left,
    top: offset.top - gesture.lastDragOffset.top,
  };
  gesture.lastDragOffset = offset;

  return boundViewerTransform({
    geometry,
    transform: {
      ...transform,
      offsetX: transform.offsetX + gesture.lastDragDelta.left,
      offsetY: transform.offsetY + gesture.lastDragDelta.top,
    },
  });
}

/** Apply release momentum only to a pan that retained its zoom throughout the gesture. */
export function settleViewerGesture({
  gesture,
  geometry,
  transform,
  now,
}: GestureTransformOptions): ViewerTransform | undefined {
  const canApplyMomentum =
    !gesture.hasPinched &&
    transform.scale > VIEWER_ZOOM_INITIAL &&
    gesture.transform.scale === transform.scale;
  if (
    !canApplyMomentum ||
    gesture.firstMoveTime === undefined ||
    gesture.lastMoveTime === undefined
  ) {
    return undefined;
  }

  const idleResetTime = gesture.lastMoveTime + PAN_IDLE_RESET_DELAY;
  const gestureTime = now >= idleResetTime ? idleResetTime : gesture.firstMoveTime;
  const elapsedTime = Math.max(MIN_GESTURE_DURATION, now - gestureTime);
  const distanceLeft = Math.abs(gesture.lastDragOffset.left);
  const distanceTop = Math.abs(gesture.lastDragOffset.top);
  const velocityLeft = distanceLeft / elapsedTime;
  const velocityTop = distanceTop / elapsedTime;

  return boundViewerTransform({
    geometry,
    transform: {
      ...transform,
      offsetX:
        transform.offsetX +
        distanceLeft * velocityLeft * PAN_VELOCITY_FACTOR * gesture.lastDragDelta.left,
      offsetY:
        transform.offsetY +
        distanceTop * velocityTop * PAN_VELOCITY_FACTOR * gesture.lastDragDelta.top,
    },
  });
}

/** Resolve touch navigation before dismissal, excluding zoomed and post-pinch gestures. */
export function resolveViewerSwipe({ point, gesture, viewport }: SwipeOptions) {
  const canSwipe =
    gesture.pointerType === 'touch' &&
    gesture.transform.scale === VIEWER_ZOOM_INITIAL &&
    !gesture.hasPinched;
  if (!canSwipe) {
    return undefined;
  }

  const offsetX = point.left - gesture.origin.left;
  const offsetY = point.top - gesture.origin.top;
  if (exceedsSwipeThreshold(offsetX, viewport.width)) {
    return offsetX < 0 ? 'next' : 'previous';
  }
  if (exceedsSwipeThreshold(offsetY, viewport.height)) {
    return 'dismiss';
  }

  return undefined;
}
