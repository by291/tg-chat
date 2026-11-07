import { cubicBezier } from 'motion';
import { elementScroll, type VirtualizerOptions } from '@tanstack/react-virtual';

const DURATION_MS = 300;
const MAX_ANIMATED_DISTANCE = 1500;
const POSITION_TOLERANCE = 0.5;
// prettier-ignore
const VERTICAL_CURVE = [
  0.1992,
  0.0106,
  0.2792,
  0.9103,
] as const;
const easeVertical = cubicBezier(...VERTICAL_CURVE);

type HistoryScrollFunction = VirtualizerOptions<HTMLDivElement, HTMLDivElement>['scrollToFn'];

interface HistoryScrollOptions {
  getAnimatedRows: () => HTMLDivElement | null;
}

/** Give virtualizer scroll requests Web K's reveal curve, including short bottom-aligned chats. */
export function createHistoryScroll({ getAnimatedRows }: HistoryScrollOptions) {
  let frame = 0;
  let targetOffset = 0;
  let revealOffset = 0;
  let isAnimating = false;

  function setRevealOffset(offset: number) {
    revealOffset = offset;
    const element = getAnimatedRows();
    if (element) {
      element.style.transform = offset !== 0 ? `translateY(${offset}px)` : '';
    }
  }

  function cancel() {
    cancelAnimationFrame(frame);
    frame = 0;
    isAnimating = false;
    setRevealOffset(0);
  }

  const scrollTo: HistoryScrollFunction = (offset, options, virtualizer) => {
    const viewport = virtualizer.scrollElement;
    if (!viewport) {
      return;
    }
    targetOffset = offset + (options.adjustments ?? 0);

    // Measurement reconciliation can retarget a smooth request with an instant write. Keep
    // that new endpoint, but let this animation retain ownership until it lands or is cancelled.
    if (isAnimating && options.behavior !== 'smooth') {
      return;
    }
    // A later send starts its own flight; it must not inherit an almost-finished timeline.
    cancelAnimationFrame(frame);
    if (options.behavior !== 'smooth') {
      setRevealOffset(0);
      elementScroll(targetOffset, { behavior: 'auto' }, virtualizer);
      return;
    }

    isAnimating = true;
    let startedAt: number | undefined;
    let previousProgress = 0;
    let currentOffset = viewport.scrollTop;

    function animateFrame(timestamp: number) {
      if (!viewport || !isAnimating) {
        return;
      }
      if (startedAt === undefined) {
        startedAt = timestamp;
        const distance = targetOffset - viewport.scrollTop;
        if (Math.abs(distance) > MAX_ANIMATED_DISTANCE) {
          const nearbyOffset = targetOffset - Math.sign(distance) * MAX_ANIMATED_DISTANCE;
          currentOffset = nearbyOffset;
          elementScroll(nearbyOffset, { behavior: 'auto' }, virtualizer);
        }
      }

      const progress = Math.min((timestamp - startedAt) / DURATION_MS, 1);
      const easedProgress = easeVertical(progress);
      const remainingDistance = targetOffset - currentOffset;
      const hasArrived = Math.abs(remainingDistance) + Math.abs(revealOffset) < POSITION_TOLERANCE;
      if (progress === 1 || hasArrived) {
        cancel();
        elementScroll(targetOffset, { behavior: 'auto' }, virtualizer);
        return;
      }

      // Rebase on measured positions so consecutive sends and late media sizing keep moving
      // toward the latest endpoint without snapping when row measurements settle.
      const stepProgress = (easedProgress - previousProgress) / (1 - previousProgress);
      // Keep fractional progress instead of integrating the browser's pixel-rounded scrollTop.
      currentOffset += remainingDistance * stepProgress;
      elementScroll(
        currentOffset,
        {
          behavior: 'auto',
        },
        virtualizer,
      );
      setRevealOffset(revealOffset * (1 - stepProgress));
      previousProgress = easedProgress;
      frame = requestAnimationFrame(animateFrame);
    }

    frame = requestAnimationFrame(animateFrame);
  };

  return {
    scrollTo,
    cancel,
    isAnimating: () => isAnimating,
    prepare: () => {
      isAnimating = true;
    },
    reveal: (offset: number) => setRevealOffset(revealOffset + offset),
  };
}
