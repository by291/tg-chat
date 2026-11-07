import { useLayoutEffect, useRef } from 'react';
import type { Message } from '../model';
import { animateGallerySlide, animateViewerPhoto, findPhotoSource } from './mediaViewerTransition';
import { VideoPlayer } from './VideoPlayer';
import styles from './MediaViewer.module.css';

interface ViewerVideoProps {
  message: Message;
  isOpen: boolean;
  activeIndex: number;
}

/** Retain video content through the thumbnail transition while stopping its playback on close. */
export function ViewerVideo({ message, isOpen, activeIndex }: ViewerVideoProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const previousIndex = useRef(activeIndex);
  const animationRef = useRef<Animation | undefined>(undefined);
  const sourceRef = useRef<HTMLElement | null>(null);
  const media = message.media;

  useLayoutEffect(
    () => {
      const frame = frameRef.current;
      if (!frame) {
        return;
      }
      const previousSource = sourceRef.current;
      const hasCurrentSource =
        previousSource?.isConnected && previousSource.dataset.photoId === message.id;
      const source = hasCurrentSource ? previousSource : findPhotoSource(message.id);
      sourceRef.current = source;
      const currentStyle = getComputedStyle(frame);
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
      // Keep the thumbnail visible until the independent viewer video has decoded its first frame.
      source?.setAttribute('data-viewer-source', 'true');

      animationRef.current =
        isNavigating && isOpen && !shouldReduceMotion
          ? animateGallerySlide({ image: frame, direction })
          : animateViewerPhoto({
              image: frame,
              source,
              isOpening: isOpen,
              shouldReduceMotion,
              startFrame,
            });

      return () => source?.removeAttribute('data-viewer-source');
    },
    // prettier-ignore
    [
    message.id,
    isOpen,
    activeIndex,
  ],
  );

  useLayoutEffect(() => () => animationRef.current?.cancel(), []);

  if (media?.kind !== 'video') {
    return null;
  }

  return (
    <div
      className={styles.photoPositioner}
      style={{
        width: `min(${media.width}px, 100vw, calc(var(--photo-height) * ${media.width / media.height}))`,
        aspectRatio: `${media.width} / ${media.height}`,
      }}
    >
      <div ref={frameRef} className={styles.videoFrame}>
        <VideoPlayer key={message.id} media={media} isActive={isOpen} />
      </div>
    </div>
  );
}
