import { useLayoutEffect, useRef } from 'react';
import type { Message } from '../model';
import { animateGallerySlide, animateViewerPhoto, findPhotoSource } from './mediaViewerTransition';
import styles from './MediaViewer.module.css';

interface ViewerPhotoProps {
  message: Message;
  isOpen: boolean;
  activeIndex: number;
}

/** Retain the photo through its return transition and restore the source on disposal. */
export function ViewerPhoto({ message, isOpen, activeIndex }: ViewerPhotoProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const previousIndex = useRef(activeIndex);
  const animationRef = useRef<Animation | undefined>(undefined);
  const sourceRef = useRef<HTMLElement | null>(null);
  const photo = message.attachment!;

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!image) {
      return;
    }
    const previousSource = sourceRef.current;
    const hasCurrentSource =
      previousSource?.isConnected && previousSource.dataset.photoId === message.id;
    const source = hasCurrentSource ? previousSource : findPhotoSource(message.id);
    sourceRef.current = source;
    // Read the presentation before cancelling so a rapid close cannot jump to full size.
    const currentStyle = getComputedStyle(image);
    const startFrame = !isOpen
      ? {
          transform: currentStyle.transform,
          clipPath: currentStyle.clipPath,
          opacity: currentStyle.opacity,
        }
      : undefined;
    animationRef.current?.cancel();
    const shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isNavigating = previousIndex.current !== activeIndex;
    const direction = Math.sign(activeIndex - previousIndex.current);
    previousIndex.current = activeIndex;
    source?.setAttribute('data-viewer-source', 'true');

    animationRef.current =
      isNavigating && isOpen && !shouldReduceMotion
        ? animateGallerySlide({ image, direction })
        : animateViewerPhoto({ image, source, isOpening: isOpen, shouldReduceMotion, startFrame });

    return () => {
      source?.removeAttribute('data-viewer-source');
    };
  }, [message.id, isOpen, activeIndex]);

  useLayoutEffect(() => () => animationRef.current?.cancel(), []);

  return (
    <div
      className={styles.photoPositioner}
      style={{
        width: `min(${photo.width}px, 100vw, calc(var(--photo-height) * ${photo.width / photo.height}))`,
        aspectRatio: `${photo.width} / ${photo.height}`,
      }}
    >
      <img
        ref={imageRef}
        className={styles.image}
        src={photo.url}
        alt={photo.name}
        width={photo.width}
        height={photo.height}
        draggable={false}
      />
    </div>
  );
}
