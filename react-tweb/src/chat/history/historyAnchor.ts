import type { Virtualizer } from '@tanstack/react-virtual';

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

  // Mounted rows already have their new CSS width, so measure them before restoring the anchor.
  const mountedRows = viewport.querySelectorAll<HTMLDivElement>('[data-index]');
  for (const row of mountedRows) {
    virtualizer.measureElement(row);
  }
  virtualizer.getTotalSize();

  if (!anchor) {
    return;
  }
  const anchorIndex = virtualizer.measurementsCache.findIndex((item) => item.key === anchor.key);
  const position = virtualizer.getOffsetForIndex(anchorIndex, 'start');
  if (anchorIndex >= 0 && position) {
    // The virtualizer also adjusts this offset target as newly mounted rows report actual sizes.
    virtualizer.scrollToOffset(position[0] - anchor.offset, { behavior: 'auto' });
  }
}
