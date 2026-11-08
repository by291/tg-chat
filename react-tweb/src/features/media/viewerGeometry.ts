import type { ViewerGeometry, ViewerSize } from './viewerTransform';

interface ViewerMeasurementOptions {
  container: HTMLElement;
  mediaElement: HTMLElement;
  getMediaBox?: () => ViewerSize;
}

/** Measure the media layout without inheriting the viewer's zoom and pan transform. */
export function measureViewerGeometry({
  container,
  mediaElement,
  getMediaBox,
}: ViewerMeasurementOptions): ViewerGeometry {
  const currentTransform = container.style.transform;
  const currentTransition = container.style.transition;
  container.style.transition = 'none';
  container.style.transform = 'none';
  const rectangle = mediaElement.getBoundingClientRect();
  container.style.transform = currentTransform;
  // Flush restoration before re-enabling transitions so measurement cannot animate from identity.
  container.getBoundingClientRect();
  container.style.transition = currentTransition;
  const viewport = { width: window.innerWidth, height: window.innerHeight };

  return {
    media: {
      left: rectangle.left,
      top: rectangle.top,
      width: rectangle.width,
      height: rectangle.height,
    },
    viewport,
    mediaBox: getMediaBox?.() ?? viewport,
  };
}
