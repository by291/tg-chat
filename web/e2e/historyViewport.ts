import type { Locator } from '@playwright/test';

// Include deferred resize correction, not only the first frame of unchanged scroll position.
const STABLE_LAYOUT_DURATION = 250;

/** Wait until scrolling and measured row geometry remain stable across deferred layout work. */
export async function waitForHistoryLayout(history: Locator) {
  await history.evaluate(async (viewport, stableDuration) => {
    let previousGeometry = '';
    let stableSince = performance.now();

    while (performance.now() - stableSince < stableDuration) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const rows = Array.from(viewport.querySelectorAll<HTMLElement>('[data-row-key]'));
      const rowGeometry = rows.map((row) => {
        const rectangle = row.getBoundingClientRect();
        return {
          key: row.dataset.rowKey,
          top: rectangle.top,
          width: rectangle.width,
          height: rectangle.height,
        };
      });

      const geometry = JSON.stringify({
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        width: viewport.clientWidth,
        height: viewport.clientHeight,
        rows: rowGeometry,
      });

      if (geometry !== previousGeometry) {
        previousGeometry = geometry;
        stableSince = performance.now();
      }
    }
  }, STABLE_LAYOUT_DURATION);
}
