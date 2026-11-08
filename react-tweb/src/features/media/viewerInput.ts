import type { RefObject } from 'react';
import type { ViewerGeometry, ViewerTransform } from './viewerTransform';

const CONTROL_SELECTOR = 'button, input, a, [data-viewer-controls]';

export interface ViewerInputOwner {
  isEnabled: boolean;
  canTransform: boolean;
  transformRef: RefObject<ViewerTransform>;
  geometryRef: RefObject<ViewerGeometry | undefined>;
  updateTransform: (transform: ViewerTransform) => void;
}

/** Keep media gestures from taking over buttons and other viewer controls. */
export function isViewerControlTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(CONTROL_SELECTOR));
}
