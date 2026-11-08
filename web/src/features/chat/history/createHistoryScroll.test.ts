// @vitest-environment jsdom
import { Virtualizer } from '@tanstack/react-virtual';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistoryScroll } from './createHistoryScroll';

const SHORT_DISTANCE = 300;
const LONG_DISTANCE = 10_000;
const MAX_VISIBLE_TRAVEL = 1500;
const SHORT_HALF_DURATION = 160;
const LONG_HALF_DURATION = 300;
const LONG_DURATION = 600;
const MIN_SHORT_MIDPOINT_PROGRESS = 0.9;
const MAX_SHORT_MIDPOINT_PROGRESS = 0.93;
const MIN_TEXT_MIDPOINT_PROGRESS = 0.7;
const MAX_TEXT_MIDPOINT_PROGRESS = 0.85;
const LONG_MIDPOINT_REMAINING_DISTANCE = 50;
const MEASUREMENT_DELAY = 80;
const CORRECTED_DISTANCE = 1200;
const MIN_VISIBLE_TRAVEL = 1400;
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

function createScrollHarness({
  maximumOffset = Infinity,
  isNavigationActive = (): boolean => false,
} = {}) {
  const viewport = document.createElement('div');
  const animatedRows = document.createElement('div');
  const scroll = createHistoryScroll({
    getAnimatedRows: () => animatedRows,
    isNavigationActive,
  });
  viewport.scrollTo = (options?: ScrollToOptions | number) => {
    if (typeof options === 'object') {
      viewport.scrollTop = Math.min(options.top ?? 0, maximumOffset);
    }
  };
  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => viewport,
    estimateSize: () => 0,
    observeElementRect: () => {},
    observeElementOffset: () => {},
    scrollToFn: scroll.scrollTo,
  });
  virtualizer.scrollElement = viewport;

  return {
    viewport,
    animatedRows,
    scroll,
    virtualizer,
  };
}

describe('message reveal motion', () => {
  it('leaves navigation in control until it releases the viewport', () => {
    let hasNavigationOwnership = true;
    const { viewport, scroll, virtualizer } = createScrollHarness({
      isNavigationActive: () => hasNavigationOwnership,
    });
    viewport.scrollTop = SHORT_DISTANCE;
    scroll.scrollTo(CORRECTED_DISTANCE, { behavior: 'auto' }, virtualizer);
    expect(viewport.scrollTop).toBe(SHORT_DISTANCE);

    hasNavigationOwnership = false;
    scroll.scrollTo(CORRECTED_DISTANCE, { behavior: 'auto' }, virtualizer);
    expect(viewport.scrollTop).toBe(CORRECTED_DISTANCE);
  });

  it('covers most of a short journey early and eases into the destination', () => {
    const { viewport, scroll, virtualizer } = createScrollHarness({
      maximumOffset: SHORT_DISTANCE,
    });
    scroll.prepare({ kind: 'photo-reveal' });
    scroll.scrollTo(SHORT_DISTANCE, { behavior: 'smooth' }, virtualizer);
    advanceFrame(0);
    advanceFrame(SHORT_HALF_DURATION);

    expect(viewport.scrollTop).toBeGreaterThan(SHORT_DISTANCE * MIN_SHORT_MIDPOINT_PROGRESS);
    expect(viewport.scrollTop).toBeLessThan(SHORT_DISTANCE * MAX_SHORT_MIDPOINT_PROGRESS);
    advanceFrame(SHORT_HALF_DURATION * 2);
    expect(viewport.scrollTop).toBe(SHORT_DISTANCE);
  });

  it('limits distant navigation to a visible final segment with a longer settling time', () => {
    const { viewport, scroll, virtualizer } = createScrollHarness();
    scroll.prepare({ kind: 'photo-reveal' });
    scroll.scrollTo(LONG_DISTANCE, { behavior: 'smooth' }, virtualizer);
    advanceFrame(0);
    expect(viewport.scrollTop).toBeGreaterThanOrEqual(LONG_DISTANCE - MAX_VISIBLE_TRAVEL);
    expect(viewport.scrollTop).toBeLessThan(LONG_DISTANCE - MIN_VISIBLE_TRAVEL);

    advanceFrame(LONG_HALF_DURATION);
    expect(viewport.scrollTop).toBeGreaterThan(LONG_DISTANCE - LONG_MIDPOINT_REMAINING_DISTANCE);
    expect(viewport.scrollTop).toBeLessThan(LONG_DISTANCE - 1);
    advanceFrame(LONG_DURATION);
    expect(viewport.scrollTop).toBe(LONG_DISTANCE);
  });

  it('uses text timing after a photo reveal finishes', () => {
    const { viewport, scroll, virtualizer } = createScrollHarness();
    scroll.prepare({ kind: 'photo-reveal' });
    scroll.scrollTo(SHORT_DISTANCE, { behavior: 'smooth' }, virtualizer);
    advanceFrame(0);
    advanceFrame(LONG_DURATION);
    viewport.scrollTop = 0;

    scroll.prepare({ kind: 'text-reveal' });
    scroll.scrollTo(SHORT_DISTANCE, { behavior: 'smooth' }, virtualizer);
    advanceFrame(LONG_DURATION);
    advanceFrame(LONG_DURATION + SHORT_HALF_DURATION);
    expect(viewport.scrollTop).toBeGreaterThan(SHORT_DISTANCE * MIN_TEXT_MIDPOINT_PROGRESS);
    expect(viewport.scrollTop).toBeLessThan(SHORT_DISTANCE * MAX_TEXT_MIDPOINT_PROGRESS);
  });

  it('absorbs a measured endpoint correction without interrupting the current movement', () => {
    const { viewport, scroll, virtualizer } = createScrollHarness();
    scroll.prepare({ kind: 'photo-reveal' });
    scroll.scrollTo(SHORT_DISTANCE, { behavior: 'smooth' }, virtualizer);
    advanceFrame(0);
    advanceFrame(MEASUREMENT_DELAY);
    const positionBeforeMeasurement = viewport.scrollTop;

    scroll.scrollTo(CORRECTED_DISTANCE, { behavior: 'auto' }, virtualizer);
    expect(viewport.scrollTop).toBe(positionBeforeMeasurement);
    advanceFrame(SHORT_HALF_DURATION);
    expect(viewport.scrollTop).toBeGreaterThan(positionBeforeMeasurement);
    expect(viewport.scrollTop).toBeLessThan(CORRECTED_DISTANCE);
    advanceFrame(LONG_DURATION);
    expect(viewport.scrollTop).toBe(CORRECTED_DISTANCE);
  });

  it('leaves the reading position alone after a user cancels navigation', () => {
    const { viewport, scroll, virtualizer } = createScrollHarness();
    scroll.prepare({ kind: 'photo-reveal' });
    scroll.scrollTo(LONG_DISTANCE, { behavior: 'smooth' }, virtualizer);
    advanceFrame(0);
    advanceFrame(SHORT_HALF_DURATION);
    scroll.cancel();
    const readingOffset = viewport.scrollTop;

    advanceFrame(LONG_DURATION);
    expect(viewport.scrollTop).toBe(readingOffset);
    expect(scroll.isAnimating()).toBe(false);
  });

  it('moves directly to the destination for a nonanimated request', () => {
    const { viewport, scroll, virtualizer } = createScrollHarness();
    scroll.scrollTo(LONG_DISTANCE, { behavior: 'auto' }, virtualizer);

    expect(viewport.scrollTop).toBe(LONG_DISTANCE);
    expect(scroll.isAnimating()).toBe(false);
  });
});
