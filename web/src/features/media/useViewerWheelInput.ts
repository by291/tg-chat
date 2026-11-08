import { useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { isViewerControlTarget, type ViewerInputOwner } from './viewerInput';
import {
  boundViewerTransform,
  getViewerWheelScale,
  VIEWER_DOUBLE_CLICK_ZOOM,
  VIEWER_ZOOM_INITIAL,
  type ViewerPoint,
} from './viewerTransform';

const WHEEL_RELEASE_DELAY = 150;

interface ViewerWheelInputOptions extends ViewerInputOwner {
  mediaId: string | undefined;
  mediaElementRef: RefObject<HTMLElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  setZoom: (scale: number, point?: ViewerPoint) => void;
  scheduleZoomSettle: (delay?: number) => void;
  setIsDirectWheelGesture: Dispatch<SetStateAction<boolean>>;
  onCancelGesture: () => void;
}

/** Adapt wheel and physical modifier input to the viewer's shared transform lifecycle. */
export function useViewerWheelInput(options: ViewerWheelInputOptions) {
  const {
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
    onCancelGesture,
  } = options;
  const isZoomModifierPressedRef = useRef(false);

  function onWheel(event: WheelEvent) {
    const currentGeometry = geometryRef.current;
    if (!isEnabled || !canTransform || !currentGeometry || isViewerControlTarget(event.target)) {
      return;
    }

    event.preventDefault();
    const currentTransform = transformRef.current;
    // Safari reports its trackpad smart-zoom gesture as control-wheel with two negative zeros.
    const isSmartZoom = event.ctrlKey && Object.is(event.deltaX, -0) && Object.is(event.deltaY, -0);
    if (isSmartZoom) {
      const scale =
        currentTransform.scale === VIEWER_ZOOM_INITIAL
          ? VIEWER_DOUBLE_CLICK_ZOOM
          : VIEWER_ZOOM_INITIAL;
      setZoom(scale, { left: event.clientX, top: event.clientY });
      scheduleZoomSettle();
      return;
    }

    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      setZoom(getViewerWheelScale({ scale: currentTransform.scale, deltaY: event.deltaY }), {
        left: event.clientX,
        top: event.clientY,
      });
      // Pinch synthesizes ctrl-wheel without a physical Control key. It must track input
      // directly; only deliberate modifier-wheel steps retain the animated zoom response.
      setIsDirectWheelGesture(!isZoomModifierPressedRef.current);
      scheduleZoomSettle(WHEEL_RELEASE_DELAY);
      return;
    }

    setIsDirectWheelGesture(!isZoomModifierPressedRef.current);
    scheduleZoomSettle(WHEEL_RELEASE_DELAY);
    updateTransform(
      boundViewerTransform({
        geometry: currentGeometry,
        transform: {
          ...currentTransform,
          offsetX: currentTransform.offsetX - event.deltaX,
          offsetY: currentTransform.offsetY - event.deltaY,
        },
      }),
    );
  }

  useLayoutEffect(() => {
    const updateZoomModifier = (event: KeyboardEvent) => {
      isZoomModifierPressedRef.current = event.ctrlKey || event.metaKey;
    };
    const clearZoomModifier = () => {
      isZoomModifierPressedRef.current = false;
      onCancelGesture();
    };
    window.addEventListener('keydown', updateZoomModifier);
    window.addEventListener('keyup', updateZoomModifier);
    window.addEventListener('blur', clearZoomModifier);
    return () => {
      window.removeEventListener('keydown', updateZoomModifier);
      window.removeEventListener('keyup', updateZoomModifier);
      window.removeEventListener('blur', clearZoomModifier);
    };
  }, []);

  const wheelListenerRef = useRef(onWheel);
  useLayoutEffect(() => {
    wheelListenerRef.current = onWheel;
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    const dispatchWheel = (event: WheelEvent) => wheelListenerRef.current(event);
    container?.addEventListener('wheel', dispatchWheel, { passive: false });

    return () => {
      container?.removeEventListener('wheel', dispatchWheel);
    };
  }, [mediaId, mediaElementRef, containerRef]);
}
