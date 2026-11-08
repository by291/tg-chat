export const VIEWER_ZOOM_MIN = 0.5;
export const VIEWER_ZOOM_MAX = 4;
export const VIEWER_ZOOM_STEP = 0.5;
export const VIEWER_ZOOM_SLIDER_STEP = 0.01;
export const VIEWER_ZOOM_INITIAL = 1;
export const VIEWER_DOUBLE_CLICK_ZOOM = 3;
export const VIEWER_QUARTER_TURN = 90;

const FULL_TURN = 360;
const HALF_TURN = 180;
const WHEEL_DELTA_LIMIT = 25;
const WHEEL_ZOOM_FACTOR = 0.01;

export interface ViewerSize {
  width: number;
  height: number;
}

export interface ViewerRect extends ViewerSize {
  left: number;
  top: number;
}

export interface ViewerPoint {
  left: number;
  top: number;
}

export interface ViewerTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
  rotation: number;
}

export interface ViewerGeometry {
  media: ViewerRect;
  viewport: ViewerSize;
  mediaBox: ViewerSize;
}

interface RotationOptions {
  geometry: ViewerGeometry;
  rotation: number;
}

interface TransformOptions {
  geometry: ViewerGeometry;
  transform: ViewerTransform;
}

interface ZoomOptions extends TransformOptions {
  scale: number;
  point: ViewerPoint;
}

interface AxisBoundaryOptions {
  offset: number;
  start: number;
  length: number;
  viewportLength: number;
  scale: number;
}

function isQuarterTurn(rotation: number) {
  return Math.abs(rotation % HALF_TURN) === VIEWER_QUARTER_TURN;
}

function boundAxis({ offset, start, length, viewportLength, scale }: AxisBoundaryOptions) {
  const centeredOffset = (viewportLength - viewportLength * scale) / 2;
  if (length * scale <= viewportLength) {
    return centeredOffset;
  }

  const minimum = viewportLength - (start + length) * scale;
  const maximum = Math.max(-start * scale, centeredOffset);
  return Math.max(minimum, Math.min(maximum, offset));
}

/** Keep user-controlled magnification inside the viewer's supported range. */
export function clampViewerScale(scale: number) {
  return Math.max(VIEWER_ZOOM_MIN, Math.min(VIEWER_ZOOM_MAX, scale));
}

/** Create the resting transform for a newly selected media item. */
export function createViewerTransform(): ViewerTransform {
  return {
    offsetX: 0,
    offsetY: 0,
    scale: VIEWER_ZOOM_INITIAL,
    rotation: 0,
  };
}

/** Refit sideways media into the same available box used by the resting layout. */
export function getViewerRotationFit({ geometry, rotation }: RotationOptions) {
  const { media, mediaBox } = geometry;
  const hasDimensions = media.width > 0 && media.height > 0;
  if (!isQuarterTurn(rotation) || !hasDimensions) {
    return 1;
  }

  return Math.min(mediaBox.width / media.height, mediaBox.height / media.width);
}

/** Describe the rotated and refitted media before screen-space zoom and pan. */
export function getRotatedViewerRect({ geometry, rotation }: RotationOptions): ViewerRect {
  const { media } = geometry;
  if (rotation % FULL_TURN === 0) {
    return media;
  }

  const fit = getViewerRotationFit({ geometry, rotation });
  const shouldSwapAxes = isQuarterTurn(rotation);
  const width = (shouldSwapAxes ? media.height : media.width) * fit;
  const height = (shouldSwapAxes ? media.width : media.height) * fit;

  return {
    left: media.left + (media.width - width) / 2,
    top: media.top + (media.height - height) / 2,
    width,
    height,
  };
}

/** Stop dragging at the rotated media edges and center axes that cannot scroll. */
export function boundViewerTransform({ geometry, transform }: TransformOptions): ViewerTransform {
  const scale = clampViewerScale(transform.scale);
  const rectangle = getRotatedViewerRect({ geometry, rotation: transform.rotation });
  if (scale === VIEWER_ZOOM_INITIAL) {
    return {
      ...transform,
      offsetX: 0,
      offsetY: 0,
      scale,
    };
  }

  return {
    ...transform,
    scale,
    offsetX: boundAxis({
      offset: transform.offsetX,
      start: rectangle.left,
      length: rectangle.width,
      viewportLength: geometry.viewport.width,
      scale,
    }),
    offsetY: boundAxis({
      offset: transform.offsetY,
      start: rectangle.top,
      length: rectangle.height,
      viewportLength: geometry.viewport.height,
      scale,
    }),
  };
}

/** Keep the pointed-at media coordinate stationary while changing magnification. */
export function zoomViewerAtPoint({ geometry, transform, scale, point }: ZoomOptions) {
  const nextScale = clampViewerScale(scale);
  const scaleRatio = nextScale / transform.scale;
  return boundViewerTransform({
    geometry,
    transform: {
      ...transform,
      scale: nextScale,
      offsetX: point.left - (point.left - transform.offsetX) * scaleRatio,
      offsetY: point.top - (point.top - transform.offsetY) * scaleRatio,
    },
  });
}

/** Use Telegram's capped additive wheel increments for modifier-wheel zoom. */
export function getViewerWheelScale({ scale, deltaY }: { scale: number; deltaY: number }) {
  const delta = Math.max(-WHEEL_DELTA_LIMIT, Math.min(WHEEL_DELTA_LIMIT, deltaY));
  return clampViewerScale(scale - delta * WHEEL_ZOOM_FACTOR);
}

/** Compose screen-space gestures outside a stable rotation and refit transform. */
export function getViewerTransformStyle({ geometry, transform }: TransformOptions) {
  const centerLeft = geometry.media.left + geometry.media.width / 2;
  const centerTop = geometry.media.top + geometry.media.height / 2;
  const fit = getViewerRotationFit({ geometry, rotation: transform.rotation });

  // Keep the same transform functions at rest so the first rotation interpolates around its pivot.
  return (
    `translate3d(${transform.offsetX}px, ${transform.offsetY}px, 0) ` +
    `scale(${transform.scale}) ` +
    `translate(${centerLeft}px, ${centerTop}px) rotate(${transform.rotation}deg) ` +
    `scale(${fit}) translate(${-centerLeft}px, ${-centerTop}px)`
  );
}
