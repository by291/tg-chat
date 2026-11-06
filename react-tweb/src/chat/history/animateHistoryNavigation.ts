import type { Virtualizer } from '@tanstack/react-virtual';

const MIN_DURATION_MS = 250;
const MAX_DURATION_MS = 600;
const MAX_ANIMATED_DISTANCE = 1500;
const SHORT_DISTANCE = 500;
const SHORT_EASING_POWER = 3.5;
const LONG_EASING_POWER = 5;
const POSITION_TOLERANCE = 1;

interface HistoryTargetOptions {
  viewport: HTMLDivElement;
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>;
  messageId: string;
  targetIndex: number;
}

interface HistoryNavigationOptions extends HistoryTargetOptions {
  shouldReduceMotion: boolean;
  onComplete: () => void;
}

interface NavigationTarget {
  index: number;
  offset: number;
  align: 'start' | 'center';
}

function findTarget({
  viewport,
  virtualizer,
  messageId,
  targetIndex,
}: HistoryTargetOptions): NavigationTarget | undefined {
  // Refresh estimates before reading the cache; newly mounted media can move the destination.
  virtualizer.getTotalSize();
  // The caller resolves the ID once per row revision. Frames read fresh sizes at that stable index.
  const item = virtualizer.measurementsCache[targetIndex];
  if (!item || item.key !== messageId) {
    return undefined;
  }

  const align = item.size >= viewport.clientHeight ? 'start' : 'center';
  const position = virtualizer.getOffsetForIndex(item.index, align);
  if (!position) {
    return undefined;
  }
  return {
    index: item.index,
    offset: position[0],
    align,
  };
}

/** Find the bounded set of rows needed for the visible part of a navigation animation. */
export function getHistoryNavigationWindow(options: HistoryTargetOptions) {
  const { viewport, virtualizer } = options;
  const target = findTarget(options);
  if (!target) {
    return undefined;
  }

  const distance = target.offset - viewport.scrollTop;
  let startingOffset = viewport.scrollTop;
  if (Math.abs(distance) > MAX_ANIMATED_DISTANCE) {
    startingOffset = target.offset - Math.sign(distance) * MAX_ANIMATED_DISTANCE;
  }
  const firstOffset = Math.min(startingOffset, target.offset);
  const lastOffset = Math.max(startingOffset, target.offset) + viewport.clientHeight;
  const firstItem = virtualizer.getVirtualItemForOffset(firstOffset);
  const lastItem = virtualizer.getVirtualItemForOffset(lastOffset);
  const padding = virtualizer.options.overscan;

  return {
    start: Math.max(0, (firstItem?.index ?? target.index) - padding),
    end: Math.min(virtualizer.options.count - 1, (lastItem?.index ?? target.index) + padding),
  };
}

/** Animate message navigation with Web K's distance cap, duration, and easing. */
export function animateHistoryNavigation(options: HistoryNavigationOptions): () => void {
  const { viewport, virtualizer, shouldReduceMotion, onComplete } = options;
  let frame = 0;
  let isCancelled = false;
  let startedAt: number | undefined;
  let duration = MIN_DURATION_MS;
  let easingPower = SHORT_EASING_POWER;
  let previousEasedProgress = 0;

  function finish(target?: NavigationTarget) {
    if (target) {
      // Let the virtualizer reconcile the measured landing instead of maintaining a second anchor.
      virtualizer.scrollToIndex(target.index, { align: target.align, behavior: 'auto' });
    }
    onComplete();
  }

  function animateFrame(timestamp: number) {
    if (isCancelled) {
      return;
    }
    const target = findTarget(options);
    if (!target) {
      finish();
      return;
    }

    if (startedAt === undefined) {
      startedAt = timestamp;
      const distance = Math.min(
        Math.abs(target.offset - viewport.scrollTop),
        MAX_ANIMATED_DISTANCE,
      );
      duration =
        MIN_DURATION_MS + (distance / MAX_ANIMATED_DISTANCE) * (MAX_DURATION_MS - MIN_DURATION_MS);
      easingPower = distance < SHORT_DISTANCE ? SHORT_EASING_POWER : LONG_EASING_POWER;
    }

    const progress = Math.min((timestamp - startedAt) / duration, 1);
    if (progress === 1) {
      finish(target);
      return;
    }

    const easedProgress = 1 - (1 - progress) ** easingPower;
    if (easedProgress === 1) {
      finish(target);
      return;
    }
    const remainingProgress = 1 - previousEasedProgress;
    const stepProgress = (easedProgress - previousEasedProgress) / remainingProgress;
    const remainingDistance = target.offset - viewport.scrollTop;
    const nextOffset = viewport.scrollTop + remainingDistance * stepProgress;

    // Rebase on the current measured position each frame so late row sizing does not restart
    // motion.
    // Intermediate frames are scroll positions, not new virtualizer navigation commands.
    viewport.scrollTop = nextOffset;
    previousEasedProgress = easedProgress;
    frame = requestAnimationFrame(animateFrame);
  }

  function prepare() {
    if (isCancelled) {
      return;
    }
    const target = findTarget(options);
    if (!target) {
      finish();
      return;
    }

    const distance = target.offset - viewport.scrollTop;
    if (shouldReduceMotion || Math.abs(distance) < POSITION_TOLERANCE) {
      finish(target);
      return;
    }

    if (Math.abs(distance) > MAX_ANIMATED_DISTANCE) {
      // Mount the destination's neighborhood before animating, rather than traversing thousands of
      // rows.
      const nearbyOffset = target.offset - Math.sign(distance) * MAX_ANIMATED_DISTANCE;
      virtualizer.scrollToOffset(nearbyOffset, { behavior: 'auto' });
    }
    frame = requestAnimationFrame(animateFrame);
  }

  // Prepending history and its scroll-anchor correction must commit before reading the start
  // position.
  frame = requestAnimationFrame(prepare);
  return () => {
    isCancelled = true;
    cancelAnimationFrame(frame);
    virtualizer.cancelScroll();
  };
}
