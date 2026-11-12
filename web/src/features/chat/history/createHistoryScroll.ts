import { cubicBezier } from 'motion';
import { elementScroll, type VirtualizerOptions } from '@tanstack/react-virtual';

const DURATION_MS = 300;
const MAX_ANIMATED_DISTANCE = 1500;
const POSITION_TOLERANCE = 0.5;
const MIN_PHOTO_DURATION = 250;
const MAX_PHOTO_DURATION = 600;
const SHORT_SCROLL_DISTANCE = 500;
const SHORT_SCROLL_POWER = 3.5;
const LONG_SCROLL_POWER = 5;
// prettier-ignore
const VERTICAL_CURVE = [
  0.1992,
  0.0106,
  0.2792,
  0.9103,
] as const;
const easeVertical = cubicBezier(...VERTICAL_CURVE);

type ScrollAnimationKind = 'text-reveal' | 'photo-reveal';

type HistoryScrollFunction = VirtualizerOptions<HTMLDivElement, HTMLDivElement>['scrollToFn'];

interface HistoryScrollOptions {
  getAnimatedRows: () => HTMLDivElement | null;
  isNavigationActive?: () => boolean;
  onRevealComplete?: () => void;
}

/** Apply message reveals and pass idle measurements through without competing with navigation. */
export function createHistoryScroll({
  getAnimatedRows,
  isNavigationActive = () => false,
  onRevealComplete,
}: HistoryScrollOptions) {
  let frame = 0;
  let targetOffset = 0;
  let revealOffset = 0;
  let isAnimating = false;
  let animationKind: ScrollAnimationKind = 'text-reveal';

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
    animationKind = 'text-reveal';
    setRevealOffset(0);
  }

  const scrollTo: HistoryScrollFunction = (offset, options, virtualizer) => {
    const viewport = virtualizer.scrollElement;
    if (!viewport) {
      return;
    }
    // Navigation reads fresh geometry itself. Reconciliation must not become another writer.
    if (isNavigationActive()) {
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
    let duration = DURATION_MS;
    let easeProgress = easeVertical;

    function animateFrame(timestamp: number) {
      if (!viewport || !isAnimating) {
        return;
      }

      if (startedAt === undefined) {
        startedAt = timestamp;
        const distance = targetOffset - viewport.scrollTop;
        if (animationKind !== 'text-reveal') {
          const travel = Math.min(
            MAX_ANIMATED_DISTANCE,
            Math.abs(distance) + Math.abs(revealOffset),
          );
          duration =
            MIN_PHOTO_DURATION +
            (travel / MAX_ANIMATED_DISTANCE) * (MAX_PHOTO_DURATION - MIN_PHOTO_DURATION);
          const power = travel < SHORT_SCROLL_DISTANCE ? SHORT_SCROLL_POWER : LONG_SCROLL_POWER;
          easeProgress = (progress) => 1 - (1 - progress) ** power;
        }
        if (Math.abs(distance) > MAX_ANIMATED_DISTANCE) {
          const nearbyOffset = targetOffset - Math.sign(distance) * MAX_ANIMATED_DISTANCE;
          currentOffset = nearbyOffset;
          elementScroll(nearbyOffset, { behavior: 'auto' }, virtualizer);
        }
      }

      const progress = Math.min((timestamp - startedAt) / duration, 1);
      const easedProgress = easeProgress(progress);
      const remainingDistance = targetOffset - currentOffset;
      const hasArrived = Math.abs(remainingDistance) + Math.abs(revealOffset) < POSITION_TOLERANCE;
      if (progress === 1 || hasArrived) {
        cancel();
        elementScroll(targetOffset, { behavior: 'auto' }, virtualizer);
        onRevealComplete?.();
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
    prepare: ({ kind }: { kind: ScrollAnimationKind }) => {
      isAnimating = true;
      animationKind = kind;
    },
    reveal: (offset: number) => setRevealOffset(revealOffset + offset),
  };
}
