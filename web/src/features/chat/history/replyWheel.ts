import { finishReplyGesture, moveReplyGesture, prepareReplyGesture } from './replyGesture';

const WHEEL_SCALE = 0.25;
const RELEASE_DELAY_MS = 75;
const LINE_HEIGHT_PX = 16;
const COAST_MINIMUM_PEAK = 12;
const COAST_DECELERATIONS = 8;
const COAST_PEAK_RATIO = 0.7;
const REACCELERATION_RATIO = 1.2;

function pixelDelta(event: WheelEvent, viewport: HTMLElement) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaX * viewport.clientWidth;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaX * LINE_HEIGHT_PX;
  }
  return event.deltaX;
}

/** Lock each wheel burst to its first axis and consume momentum after a completed reply. */
export function attachReplyWheel(viewport: HTMLElement, onReply: (id: string) => void) {
  let gesture: ReturnType<typeof prepareReplyGesture>;
  let axis: 'native' | 'reply' | undefined;
  let timer: number | undefined;
  let peak = 0;
  let previous = 0;
  let decelerations = 0;

  function clear() {
    window.clearTimeout(timer);
    if (gesture) {
      finishReplyGesture(gesture);
    }
    gesture = undefined;
    axis = undefined;
    peak = 0;
    previous = 0;
    decelerations = 0;
  }

  function release() {
    if (gesture) {
      finishReplyGesture(gesture, onReply);
      gesture = undefined;
    }
  }

  function isCoasting(magnitude: number) {
    peak = Math.max(peak, magnitude);
    if (magnitude < previous) {
      decelerations += 1;
    } else if (magnitude > previous * REACCELERATION_RATIO) {
      decelerations = 0;
    }
    previous = magnitude;
    return (
      peak >= COAST_MINIMUM_PEAK &&
      decelerations >= COAST_DECELERATIONS &&
      magnitude < peak * COAST_PEAK_RATIO
    );
  }

  function onWheel(event: WheelEvent) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      clear();
      return;
    }
    if (!axis) {
      const candidate = prepareReplyGesture(event.target);
      const isHorizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (candidate && isHorizontal && event.deltaX * candidate.direction < 0) {
        gesture = candidate;
        axis = 'reply';
      } else {
        axis = 'native';
      }
    }

    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      release();
      clear();
    }, RELEASE_DELAY_MS);
    if (axis === 'native') {
      return;
    }

    // The first event owns the whole burst, even if the moving row leaves the pointer.
    event.preventDefault();
    if (!gesture) {
      return;
    }
    const delta = -pixelDelta(event, viewport) * gesture.direction;
    moveReplyGesture(gesture, gesture.distance + delta * WHEEL_SCALE);
    if (isCoasting(Math.abs(delta))) {
      release();
    }
  }

  viewport.addEventListener('wheel', onWheel, { passive: false });
  return {
    clear,
    dispose: () => {
      viewport.removeEventListener('wheel', onWheel);
      clear();
    },
  };
}
