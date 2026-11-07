import { useRef } from 'react';
import type { Message } from '../model';
import { useViewerMediaTransition, type ViewerTransitionProps } from './useViewerMediaTransition';
import { VideoPlayer } from './VideoPlayer';
import styles from './MediaViewer.module.css';

interface ViewerVideoProps extends ViewerTransitionProps {
  message: Message;
  isOpen: boolean;
  activeIndex: number;
}

/** Retain video content through the thumbnail transition while stopping its playback on close. */
export function ViewerVideo({
  message,
  isOpen,
  phase,
  direction,
  onSettled,
  positionerRef,
}: ViewerVideoProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const media = message.media;
  useViewerMediaTransition({
    elementRef: frameRef,
    messageId: message.id,
    isOpen,
    phase,
    direction,
    onSettled,
  });

  if (media?.kind !== 'video') {
    return null;
  }

  return (
    <div
      ref={positionerRef}
      className={styles.photoPositioner}
      data-viewer-media
      data-slide-phase={phase}
      style={{
        width: `min(${media.width}px, 100vw, calc(var(--photo-height) * ${media.width / media.height}))`,
        aspectRatio: `${media.width} / ${media.height}`,
      }}
    >
      <div ref={frameRef} className={styles.videoFrame}>
        <VideoPlayer key={message.id} media={media} isActive={isOpen && phase !== 'leaving'} />
      </div>
    </div>
  );
}
