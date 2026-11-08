import { useLayoutEffect, useRef, useState } from 'react';
import { measureViewerGeometry } from './viewerGeometry';
import { isViewerControlTarget } from './viewerInput';
import { useViewerPointerInput } from './useViewerPointerInput';
import { useViewerWheelInput } from './useViewerWheelInput';
import type { CSSProperties, MouseEvent, RefObject } from 'react';
import {
  boundViewerTransform,
  createViewerTransform,
  getViewerTransformStyle,
  VIEWER_DOUBLE_CLICK_ZOOM,
  VIEWER_QUARTER_TURN,
  VIEWER_ZOOM_INITIAL,
  VIEWER_ZOOM_STEP,
  zoomViewerAtPoint,
  type ViewerGeometry,
  type ViewerPoint,
  type ViewerSize,
  type ViewerTransform,
} from './viewerTransform';

const ZOOM_SETTLE_DELAY = 300;

interface ViewerTransformOptions {
  mediaId: string | undefined;
  mediaElementRef: RefObject<HTMLElement | null>;
  isEnabled?: boolean;
  canTransform?: boolean;
  getMediaBox?: () => ViewerSize;
  onNavigate?: (direction: -1 | 1) => void;
  onDismiss?: () => void;
}

export type ViewerTransformController = ReturnType<typeof useViewerTransform>;

/** Own viewer gestures on an outer layer independently of the media's opening animation. */
export function useViewerTransform(options: ViewerTransformOptions) {
  const { mediaId, mediaElementRef, isEnabled = true, canTransform = true } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef(options);
  // Input adapters share these refs; only updateTransform publishes a new transform.
  const transformRef = useRef(createViewerTransform());
  const geometryRef = useRef<ViewerGeometry | undefined>(undefined);
  const measuredMediaRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<ResizeObserver | undefined>(undefined);
  const shouldIgnoreClickRef = useRef(false);
  const zoomSettleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [transform, setTransform] = useState(createViewerTransform);
  const [geometry, setGeometry] = useState<ViewerGeometry | undefined>(undefined);
  const [isDragging, setIsDragging] = useState(false);
  const [isDirectWheelGesture, setIsDirectWheelGesture] = useState(false);

  function updateTransform(nextTransform: ViewerTransform) {
    transformRef.current = nextTransform;
    setTransform(nextTransform);
  }

  function cancelZoomSettle() {
    clearTimeout(zoomSettleTimerRef.current);
    zoomSettleTimerRef.current = undefined;
  }

  function cancelGesture() {
    // Cancel pointer ownership before restoring the viewer's animated response.
    pointerInput.cancelPointerGesture();
    setIsDirectWheelGesture(false);
  }

  function measureMedia() {
    const mediaElement = mediaElementRef.current;
    const container = containerRef.current;
    if (!mediaElement || !container) {
      return;
    }

    if (measuredMediaRef.current !== mediaElement) {
      observerRef.current?.disconnect();
      observerRef.current?.observe(mediaElement);
      measuredMediaRef.current = mediaElement;
    }

    const nextGeometry = measureViewerGeometry({
      container,
      mediaElement,
      getMediaBox: optionsRef.current.getMediaBox,
    });

    geometryRef.current = nextGeometry;
    setGeometry(nextGeometry);
    updateTransform(
      boundViewerTransform({ geometry: nextGeometry, transform: transformRef.current }),
    );
  }

  function setZoom(scale: number, point?: ViewerPoint) {
    const currentGeometry = geometryRef.current;
    if (!isEnabled || !canTransform || !currentGeometry) {
      return;
    }

    // Slider scrubbing owns its release; an earlier wheel timeout must not interrupt it.
    cancelZoomSettle();
    setIsDirectWheelGesture(false);
    const anchor = point ?? {
      left: currentGeometry.viewport.width / 2,
      top: currentGeometry.viewport.height / 2,
    };
    updateTransform(
      zoomViewerAtPoint({
        geometry: currentGeometry,
        transform: transformRef.current,
        scale,
        point: anchor,
      }),
    );
  }

  function resetZoom() {
    cancelZoomSettle();
    setIsDirectWheelGesture(false);
    updateTransform({
      ...createViewerTransform(),
      rotation: transformRef.current.rotation,
    });
  }

  function finishZoomGesture() {
    cancelZoomSettle();
    setIsDirectWheelGesture(false);
    if (isEnabled && canTransform && transformRef.current.scale < VIEWER_ZOOM_INITIAL) {
      resetZoom();
    }
  }

  function scheduleZoomSettle(delay = ZOOM_SETTLE_DELAY) {
    cancelZoomSettle();
    zoomSettleTimerRef.current = setTimeout(finishZoomGesture, delay);
  }

  function zoomIn() {
    setZoom(transformRef.current.scale + VIEWER_ZOOM_STEP);
    scheduleZoomSettle();
  }

  function zoomOut() {
    setZoom(transformRef.current.scale - VIEWER_ZOOM_STEP);
    scheduleZoomSettle();
  }

  function toggleZoom() {
    if (!isEnabled || !canTransform) {
      return;
    }

    if (transformRef.current.scale !== VIEWER_ZOOM_INITIAL) {
      resetZoom();
      return;
    }

    zoomIn();
  }

  function rotateCounterclockwise() {
    setIsDirectWheelGesture(false);
    const currentGeometry = geometryRef.current;
    if (!isEnabled || !canTransform || !currentGeometry) {
      return;
    }

    updateTransform(
      boundViewerTransform({
        geometry: currentGeometry,
        transform: {
          ...transformRef.current,
          rotation: transformRef.current.rotation - VIEWER_QUARTER_TURN,
        },
      }),
    );
  }

  function consumeGestureClick() {
    const shouldIgnoreClick = shouldIgnoreClickRef.current;
    shouldIgnoreClickRef.current = false;
    return shouldIgnoreClick;
  }

  function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (!isEnabled || !canTransform || isViewerControlTarget(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (transformRef.current.scale !== VIEWER_ZOOM_INITIAL) {
      resetZoom();
      return;
    }

    setZoom(VIEWER_DOUBLE_CLICK_ZOOM, { left: event.clientX, top: event.clientY });
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (consumeGestureClick()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  const pointerInput = useViewerPointerInput({
    isEnabled,
    canTransform,
    transformRef,
    geometryRef,
    shouldIgnoreClickRef,
    updateTransform,
    cancelZoomSettle,
    setIsDirectWheelGesture,
    setIsDragging,
    resetZoom,
    onCancelGesture: cancelGesture,
    onNavigate: (direction) => optionsRef.current.onNavigate?.(direction),
    onDismiss: () => optionsRef.current.onDismiss?.(),
  });

  useViewerWheelInput({
    mediaId,
    mediaElementRef,
    containerRef,
    isEnabled,
    canTransform,
    transformRef,
    geometryRef,
    updateTransform,
    setZoom,
    scheduleZoomSettle,
    setIsDirectWheelGesture,
    onCancelGesture: cancelGesture,
  });

  useLayoutEffect(() => {
    optionsRef.current = options;
    if (mediaElementRef.current !== measuredMediaRef.current) {
      measureMedia();
    }
  });

  useLayoutEffect(() => {
    // A busy or closing viewer must not finish a gesture that began on an earlier state.
    if (pointerInput.hasActiveGesture()) {
      shouldIgnoreClickRef.current = true;
    }
    cancelZoomSettle();
    cancelGesture();
    if (!canTransform) {
      updateTransform(createViewerTransform());
    }
  }, [isEnabled, canTransform]);

  useLayoutEffect(() => {
    updateTransform(createViewerTransform());
    cancelZoomSettle();
    cancelGesture();
    shouldIgnoreClickRef.current = false;
    measureMedia();

    const mediaElement = mediaElementRef.current;
    window.addEventListener('resize', measureMedia);
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measureMedia);
    observerRef.current = observer;
    if (mediaElement) {
      observer?.observe(mediaElement);
    }

    return () => {
      cancelZoomSettle();
      window.removeEventListener('resize', measureMedia);
      observer?.disconnect();
      observerRef.current = undefined;
    };
  }, [mediaId, mediaElementRef]);

  const transformStyle: CSSProperties = {
    transform: geometry ? getViewerTransformStyle({ geometry, transform }) : undefined,
    transformOrigin: '0 0',
    touchAction: 'none',
    transition: isDragging || isDirectWheelGesture ? 'none' : undefined,
  };

  return {
    containerRef,
    transformStyle,
    transform,
    scale: transform.scale,
    rotation: transform.rotation,
    isZooming: transform.scale !== VIEWER_ZOOM_INITIAL,
    isDragging,
    gestureProps: {
      ...pointerInput.bindGestures(),
      onDoubleClick,
      onClickCapture,
    },
    zoomIn,
    zoomOut,
    toggleZoom,
    resetZoom,
    finishZoomGesture,
    setZoom,
    rotateCounterclockwise,
    consumeGestureClick,
    refreshGeometry: measureMedia,
  };
}
