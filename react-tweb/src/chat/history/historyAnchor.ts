import type { Virtualizer } from '@tanstack/react-virtual';

const RESTORE_MEASUREMENT_FRAMES = 4;

export interface ReadingAnchor {
  key: string;
  offset: number;
}

/** Capture a visible row relative to its viewport before invalidating width-dependent heights. */
export function readHistoryAnchor(viewport: HTMLElement): ReadingAnchor | undefined {
  const viewportTop = viewport.getBoundingClientRect().top;
  const rows = viewport.querySelectorAll<HTMLElement>('[data-row-key]');
  for (const row of rows) {
    const rectangle = row.getBoundingClientRect();
    if (rectangle.bottom > viewportTop && row.dataset.rowKey) {
      return { key: row.dataset.rowKey, offset: rectangle.top - viewportTop };
    }
  }
  return undefined;
}

/** Read the current anchor from measured rows without walking the mounted message DOM. */
export function readMeasuredHistoryAnchor({
  viewport,
  virtualizer,
}: {
  viewport: HTMLElement;
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>;
}): ReadingAnchor | undefined {
  const totalHeight = virtualizer.getTotalSize();
  const viewportHeight = virtualizer.scrollRect?.height ?? 0;
  const bottomAlignment = Math.max(0, viewportHeight - totalHeight);
  const scrollTop = viewport.scrollTop;
  const item = virtualizer.getVirtualItemForOffset(Math.max(0, scrollTop - bottomAlignment));
  if (!item) {
    return undefined;
  }
  return {
    key: String(item.key),
    offset: item.start + bottomAlignment - scrollTop,
  };
}

/** Rebuild width-sensitive measurements and restore the same row's viewport-relative offset. */
export function remeasureHistory({
  viewport,
  virtualizer,
  anchor = readHistoryAnchor(viewport),
}: {
  viewport: HTMLElement;
  anchor?: ReadingAnchor;
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>;
}) {
  virtualizer.measure();
  // Rebuild the cleared cache first: resizeItem otherwise compares against stale measured sizes
  // and can discard an unchanged height instead of replacing the new estimate.
  virtualizer.getTotalSize();

  // measureElement can skip synchronous reads while scrolling. After clearing the cache,
  // unchanged rows may never emit another resize event, so explicitly seed their actual heights.
  const mountedRows = viewport.querySelectorAll<HTMLDivElement>('[data-index]');
  for (const row of mountedRows) {
    const index = virtualizer.indexFromElement(row);
    const height = row.getBoundingClientRect().height;
    virtualizer.resizeItem(index, height);
  }
  virtualizer.getTotalSize();

  if (!anchor) {
    return;
  }
  const anchorIndex = virtualizer.measurementsCache.findIndex((item) => item.key === anchor.key);
  let frame = 0;
  let remainingFrames = RESTORE_MEASUREMENT_FRAMES;

  const restoreMeasuredAnchor = () => {
    virtualizer.getTotalSize();
    const item = virtualizer.measurementsCache[anchorIndex];
    if (!item || item.key !== anchor.key) {
      return;
    }
    const bottomAlignment = Math.max(0, viewport.clientHeight - virtualizer.getTotalSize());
    // Apply the relative offset before clamping at the scroll boundary.
    virtualizer.scrollToOffset(item.start + bottomAlignment - anchor.offset, {
      behavior: 'auto',
    });

    // Rebuilt estimates can mount different rows whose ResizeObserver reports arrive next frame.
    // A short, cancellable settling pass keeps those first measurements on the same reading anchor.
    remainingFrames -= 1;
    if (remainingFrames > 0) {
      frame = requestAnimationFrame(restoreMeasuredAnchor);
    }
  };

  restoreMeasuredAnchor();
  return () => {
    cancelAnimationFrame(frame);
    virtualizer.cancelScroll();
  };
}
