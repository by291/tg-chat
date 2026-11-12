import type { Virtualizer } from '@tanstack/react-virtual';
import { HISTORY_DATE_ROW_HEIGHT } from './historyDates';

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
  alignment?: 'start' | 'center' | 'end';
}

interface HistoryNavigationOptions extends HistoryTargetOptions {
  shouldReduceMotion: boolean;
  onComplete: () => void;
}

interface NavigationTarget {
  index: number;
  offset: number;
}

function findTarget({
  viewport,
  virtualizer,
  messageId,
  targetIndex,
  alignment = 'center',
}: HistoryTargetOptions): NavigationTarget | undefined {
  // Refresh estimates before reading the cache; newly mounted media can move the destination.
  virtualizer.getTotalSize();
  // The caller resolves the ID once per row revision. Frames read fresh sizes at that stable index.
  const item = virtualizer.measurementsCache[targetIndex];
  if (!item || item.key !== messageId) {
    return undefined;
  }

  const maximumOffset = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  if (alignment === 'end') {
    return { index: item.index, offset: maximumOffset };
  }

  const topInset = virtualizer.options.scrollPaddingStart;
  const bottomInset = virtualizer.options.scrollPaddingEnd;
  const visibleHeight = Math.max(0, viewport.clientHeight - topInset - bottomInset);
  // The sticky date remains above the unread divider when opening at the read boundary.
  const alignedOffset =
    alignment === 'start' ? HISTORY_DATE_ROW_HEIGHT : Math.max(0, (visibleHeight - item.size) / 2);
  const desiredOffset = item.start - topInset - alignedOffset;

  return {
    index: item.index,
    offset: Math.max(0, Math.min(desiredOffset, maximumOffset)),
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
  let startingOffset = viewport.scrollTop;
  let currentOffset = startingOffset;
  let plannedOffset = startingOffset;

  function finish(target?: NavigationTarget) {
    // Release exclusive ownership before the virtualizer performs the final reconciliation.
    onComplete();
    if (target) {
      // Let the virtualizer reconcile the measured landing instead of maintaining a second anchor.
      // Use the same unobscured area for both centered jumps and unread starts.
      virtualizer.scrollToOffset(target.offset, { behavior: 'auto' });
    }
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

    const hasTargetChanged =
      startedAt !== undefined && Math.abs(target.offset - plannedOffset) > POSITION_TOLERANCE;
    if (startedAt === undefined || hasTargetChanged) {
      // A changed layout gets its own remaining journey; it cannot inherit an expired deadline
      // and turn the final frame into an instant jump to a newly measured destination.
      startedAt = timestamp;
      startingOffset = currentOffset;
      plannedOffset = target.offset;
      const distance = Math.min(Math.abs(plannedOffset - startingOffset), MAX_ANIMATED_DISTANCE);
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

    // Sample one trajectory from elapsed time. Reading pixel-rounded scrollTop back into the
    // next frame would distort its low-speed tail, especially on high-refresh-rate displays.
    currentOffset = startingOffset + (plannedOffset - startingOffset) * easedProgress;
    viewport.scrollTop = currentOffset;
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
      viewport.scrollTop = nearbyOffset;
    }
    currentOffset = viewport.scrollTop;
    frame = requestAnimationFrame(animateFrame);
  }

  function measureDestination() {
    if (isCancelled) {
      return;
    }

    // The virtualizer skips ref measurements during an active wheel gesture. Read the mounted
    // corridor explicitly, then let its canvas commit before computing a navigation trajectory.
    const mountedRows = viewport.querySelectorAll<HTMLDivElement>('[data-index]');

    for (const row of mountedRows) {
      const index = virtualizer.indexFromElement(row);
      virtualizer.resizeItem(index, row.getBoundingClientRect().height);
    }

    virtualizer.getTotalSize();
    frame = requestAnimationFrame(prepare);
  }

  // Prepending history and its scroll-anchor correction must commit before reading the start
  // position.
  frame = requestAnimationFrame(measureDestination);

  return () => {
    isCancelled = true;
    cancelAnimationFrame(frame);
    virtualizer.cancelScroll();
  };
}
