// @vitest-environment jsdom
import { elementScroll, Virtualizer } from '@tanstack/react-virtual';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animateHistoryNavigation } from './animateHistoryNavigation';

const VIEWPORT_HEIGHT = 600;
const TARGET_OFFSET = 700;
const CHANGED_TARGET_OFFSET = 1100;
const FRAME_INTERVAL = 16;
const SAMPLE_INTERVAL = 80;
const SETTLED_TIME = 1000;
const LATE_LAYOUT_TIME = 400;
const MAX_LATE_FRAME_DISTANCE = (CHANGED_TARGET_OFFSET - TARGET_OFFSET) / 4;
const callbacks = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrameId += 1;
    callbacks.set(nextFrameId, callback);
    return nextFrameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => callbacks.delete(frame));
});

afterEach(() => {
  callbacks.clear();
  vi.unstubAllGlobals();
});

function advanceFrame(timestamp: number) {
  const pending = Array.from(callbacks.values());
  callbacks.clear();

  for (const callback of pending) {
    callback(timestamp);
  }
}

function createNavigationHarness() {
  const viewport = document.createElement('div');
  let maximumOffset = TARGET_OFFSET;
  let scrollOffset = 0;
  let isFinished = false;
  Object.defineProperties(viewport, {
    clientHeight: { get: () => VIEWPORT_HEIGHT },
    scrollHeight: { get: () => VIEWPORT_HEIGHT + maximumOffset },
    scrollTop: {
      get: () => scrollOffset,
      set: (offset: number) => {
        // Native rounding must not feed back into the animation's next position.
        scrollOffset = Math.round(Math.max(0, Math.min(offset, maximumOffset)));
      },
    },
  });
  viewport.scrollTo = (options?: ScrollToOptions | number) => {
    if (typeof options === 'object') {
      viewport.scrollTop = options.top ?? 0;
    }
  };
  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: 1,
    getScrollElement: () => viewport,
    getItemKey: () => 'last-message',
    estimateSize: () => VIEWPORT_HEIGHT + maximumOffset,
    observeElementRect: () => {},
    observeElementOffset: () => {},
    scrollToFn: elementScroll,
  });
  virtualizer.scrollElement = viewport;
  const cancel = animateHistoryNavigation({
    viewport,
    virtualizer,
    messageId: 'last-message',
    targetIndex: 0,
    alignment: 'end',
    shouldReduceMotion: false,
    onComplete: () => {
      isFinished = true;
    },
  });
  advanceFrame(0);
  advanceFrame(FRAME_INTERVAL);
  advanceFrame(FRAME_INTERVAL * 2);

  return {
    viewport,
    cancel,
    isFinished: () => isFinished,
    changeTarget: (offset: number) => {
      maximumOffset = offset;
    },
  };
}

describe('navigation lifecycle', () => {
  it('decelerates throughout the journey despite native pixel rounding', () => {
    const { viewport, isFinished } = createNavigationHarness();
    let previousOffset = 0;
    let previousDistance = Infinity;

    for (let elapsed = SAMPLE_INTERVAL; elapsed <= LATE_LAYOUT_TIME; elapsed += SAMPLE_INTERVAL) {
      advanceFrame(FRAME_INTERVAL * 2 + elapsed);
      const distance = viewport.scrollTop - previousOffset;
      expect(distance).toBeGreaterThanOrEqual(0);
      expect(distance).toBeLessThan(previousDistance);
      previousOffset = viewport.scrollTop;
      previousDistance = distance;
    }

    advanceFrame(SETTLED_TIME);
    expect(viewport.scrollTop).toBe(TARGET_OFFSET);
    expect(isFinished()).toBe(true);
  });

  it('does not snap a late measured destination into an expired final frame', () => {
    const { viewport, changeTarget, isFinished } = createNavigationHarness();
    advanceFrame(LATE_LAYOUT_TIME);
    const positionBeforeMeasurement = viewport.scrollTop;
    changeTarget(CHANGED_TARGET_OFFSET);
    advanceFrame(LATE_LAYOUT_TIME + FRAME_INTERVAL);
    advanceFrame(LATE_LAYOUT_TIME + FRAME_INTERVAL * 2);

    expect(viewport.scrollTop).toBeGreaterThanOrEqual(positionBeforeMeasurement);
    expect(viewport.scrollTop - positionBeforeMeasurement).toBeLessThan(MAX_LATE_FRAME_DISTANCE);
    expect(isFinished()).toBe(false);
    advanceFrame(SETTLED_TIME);
    expect(viewport.scrollTop).toBe(CHANGED_TARGET_OFFSET);
    expect(isFinished()).toBe(true);
  });

  it('leaves the user position untouched after cancellation', () => {
    const { viewport, cancel } = createNavigationHarness();
    advanceFrame(SAMPLE_INTERVAL);
    cancel();
    viewport.scrollTop = 0;
    advanceFrame(SETTLED_TIME);
    expect(viewport.scrollTop).toBe(0);
  });
});
