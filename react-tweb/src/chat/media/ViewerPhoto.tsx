import { useRef } from 'react';
import type { Message } from '../model';
import { useViewerMediaTransition, type ViewerTransitionProps } from './useViewerMediaTransition';
import styles from './MediaViewer.module.css';

interface ViewerPhotoProps extends ViewerTransitionProps {
  message: Message;
  isOpen: boolean;
  activeIndex: number;
}

/** Retain the photo through its return transition and restore the source on disposal. */
export function ViewerPhoto({
  message,
  isOpen,
  phase,
  direction,
  onSettled,
  positionerRef,
}: ViewerPhotoProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const photo = message.attachment!;
  useViewerMediaTransition({
    elementRef: imageRef,
    messageId: message.id,
    isOpen,
    phase,
    direction,
    onSettled,
  });

  return (
    <div
      ref={positionerRef}
      className={styles.photoPositioner}
      data-viewer-media
      data-slide-phase={phase}
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
