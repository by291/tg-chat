const PREVIEW_WIDTH = 432;
const PREVIEW_HEIGHT = 540;
const PREVIEW_GUTTER = 8;
export const PREVIEW_MOBILE_BREAKPOINT = 760;

export interface PreviewAnchor {
  left: number;
  right: number;
  centerY: number;
}

/** Anchor previews to the sidebar edge rather than the padded conversation row. */
export function readPreviewAnchor(element: HTMLElement): PreviewAnchor {
  const row = element.getBoundingClientRect();
  const sidebar = element.closest('aside')?.getBoundingClientRect();

  return {
    left: row.left,
    right: sidebar?.right ?? row.right,
    centerY: row.top + row.height / 2,
  };
}

/** Fit the Telegram-sized preview beside its row, or center it on a narrow viewport. */
export function getPreviewPosition(anchor: PreviewAnchor) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(PREVIEW_WIDTH, viewportWidth - PREVIEW_GUTTER * 2);
  const height = Math.min(PREVIEW_HEIGHT, viewportHeight - PREVIEW_GUTTER * 2);
  const isMobile = viewportWidth <= PREVIEW_MOBILE_BREAKPOINT;
  let left = anchor.right + PREVIEW_GUTTER;
  let top = anchor.centerY - height / 2;

  if (isMobile) {
    left = (viewportWidth - width) / 2;
    top = (viewportHeight - height) / 2;
  } else if (left + width + PREVIEW_GUTTER > viewportWidth) {
    left = anchor.left - width - PREVIEW_GUTTER;
  }

  return {
    width,
    height,
    left: Math.max(PREVIEW_GUTTER, left),
    top: Math.max(PREVIEW_GUTTER, Math.min(top, viewportHeight - height - PREVIEW_GUTTER)),
  };
}
