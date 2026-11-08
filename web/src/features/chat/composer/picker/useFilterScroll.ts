import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, type RefObject } from 'react';

const MIN_SCROLL_DURATION_MS = 250;
const MAX_SCROLL_DURATION_MS = 600;
const REFERENCE_SCROLL_DISTANCE = 1500;
const SHORT_SCROLL_EXPONENT = 3.5;

/** Match Telegram's category-centering curve and cancel it when the user takes over. */
export function useFilterScroll(containerRef: RefObject<HTMLDivElement | null>) {
  const frameRef = useRef<number | undefined>(undefined);
  const shouldReduceMotion = useReducedMotion();

  function cancelScroll() {
    if (frameRef.current !== undefined) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    }
  }

  useEffect(() => cancelScroll, []);

  function scrollToOffset(offset: number) {
    cancelScroll();
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const maximumOffset = container.scrollWidth - container.clientWidth;
    const target = Math.max(0, Math.min(offset, maximumOffset));
    const start = container.scrollLeft;
    const distance = target - start;
    if (shouldReduceMotion || Math.abs(distance) < 1) {
      container.scrollLeft = target;
      return;
    }

    const durationRange = MAX_SCROLL_DURATION_MS - MIN_SCROLL_DURATION_MS;
    const duration =
      MIN_SCROLL_DURATION_MS + (Math.abs(distance) / REFERENCE_SCROLL_DISTANCE) * durationRange;
    const startTime = performance.now();

    function advanceScroll(now: number) {
      if (!container) {
        return;
      }

      const progress = Math.min((now - startTime) / duration, 1);
      const easedProgress = 1 - (1 - progress) ** SHORT_SCROLL_EXPONENT;
      container.scrollLeft = Math.round(start + distance * easedProgress);
      frameRef.current = undefined;
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(advanceScroll);
      }
    }

    frameRef.current = requestAnimationFrame(advanceScroll);
  }

  return { scrollToOffset, cancelScroll };
}
