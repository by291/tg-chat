import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animateGallerySlide, animateViewerPhoto, findPhotoSource } from './mediaViewerTransition';

export type ViewerSlidePhase = 'opening' | 'entering' | 'leaving' | 'idle';

export interface ViewerTransitionProps {
  phase?: ViewerSlidePhase;
  direction?: number;
  onSettled?: () => void;
  positionerRef?: RefObject<HTMLDivElement | null>;
}

interface ViewerMediaTransitionOptions extends ViewerTransitionProps {
  elementRef: RefObject<HTMLElement | null>;
  messageId: string;
  isOpen: boolean;
}

/** Keep each media layer alive through its own open, paired slide, or return animation. */
export function useViewerMediaTransition({
  elementRef,
  messageId,
  isOpen,
  phase = 'opening',
  direction = 0,
  onSettled,
}: ViewerMediaTransitionOptions) {
  const animationRef = useRef<Animation | undefined>(undefined);
  const sourceRef = useRef<HTMLElement | null>(null);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  useLayoutEffect(
    () => {
      const element = elementRef.current;
      if (!element) {
        return;
      }

      const previousSource = sourceRef.current;
      const hasCurrentSource =
        previousSource?.isConnected && previousSource.dataset.photoId === messageId;
      const source = hasCurrentSource ? previousSource : findPhotoSource(messageId);
      sourceRef.current = source;

      // Capture an interrupted opening before cancellation removes its visible transform.
      const currentStyle = getComputedStyle(element);
      const startFrame = !isOpen
        ? {
            transform: currentStyle.transform,
            clipPath: currentStyle.clipPath,
            opacity: currentStyle.opacity,
          }
        : undefined;
      animationRef.current?.cancel();
      source?.setAttribute('data-viewer-source', 'true');
      let isDisposed = false;

      const start = () => {
        if (isDisposed || (isOpen && phase === 'idle')) {
          return;
        }

        const shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const isSliding = isOpen && (phase === 'entering' || phase === 'leaving');
        let animation: Animation | undefined;
        if (isSliding && !shouldReduceMotion) {
          animation = animateGallerySlide({
            image: element,
            direction,
            isEntering: phase === 'entering',
          });
        } else if (!isSliding) {
          animation = animateViewerPhoto({
            image: element,
            source,
            isOpening: isOpen,
            shouldReduceMotion,
            startFrame,
          });
        }

        animationRef.current = animation;
        const completion = animation?.finished ?? Promise.resolve();
        void completion
          .then(() => {
            if (!isDisposed && phase !== 'leaving' && isOpen) {
              onSettledRef.current?.();
            }
          })
          // Cancellation rejects finished; a disposed slide must not publish settlement.
          .catch(() => {});
      };

      start();

      return () => {
        isDisposed = true;
        source?.removeAttribute('data-viewer-source');
      };
    },
    // prettier-ignore
    [
      elementRef,
      messageId,
      isOpen,
      phase,
      direction,
    ],
  );

  // The next phase must capture the presentation before cancelling an unfinished animation.
  useLayoutEffect(() => () => animationRef.current?.cancel(), []);
}
