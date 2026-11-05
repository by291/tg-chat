import { createAlbumPhoto } from './photoGallery';
import { useRef } from 'react';
import { useVisiblePlayback } from './useVisiblePlayback';
import { getMediaGeometry } from './mediaGeometry';
import type { MessageMedia, PhotoAttachment } from './messageMedia';
import type { Message } from './model';
import styles from './MessageBody.module.css';

const ROUND_VIDEO_SIZE = 240;

interface PhotoFrameProps {
  photo: PhotoAttachment;
  hasCaption: boolean;
  onOpen: () => void;
}

/** Reserve the photo frame independently of the image loading lifecycle. */
export function PhotoFrame({ photo, hasCaption, onOpen }: PhotoFrameProps) {
  const frame = getMediaGeometry({ ...photo, hasCaption });
  return (
    <button
      className={styles.photoFrame}
      style={{ width: frame.width, aspectRatio: `${frame.width} / ${frame.height}` }}
      onClick={onOpen}
      aria-label={`Open image: ${photo.name}`}
    >
      <img
        src={photo.url}
        alt={photo.name}
        width={photo.width}
        height={photo.height}
        loading="lazy"
      />
    </button>
  );
}

/** Render album tiles within one measured message and open the selected photo. */
export function AlbumFrame({
  message,
  photos,
  onOpenMedia,
}: {
  message: Message;
  photos: PhotoAttachment[];
  onOpenMedia: (message: Message) => void;
}) {
  return (
    <div className={styles.album} data-count={photos.length}>
      {photos.map((photo, index) => (
        <button
          key={`${photo.url}-${index}`}
          aria-label={`Open album photo ${index + 1}: ${photo.name}`}
          onClick={() => onOpenMedia(createAlbumPhoto(message, photo, index))}
        >
          <img
            src={photo.url}
            alt={photo.name}
            width={photo.width}
            height={photo.height}
            loading="lazy"
          />
        </button>
      ))}
    </div>
  );
}

/** Play videos on demand and pause mounted overscan media when it leaves the viewport. */
export function VideoFrame({
  media,
  hasCaption,
}: {
  media: Extract<MessageMedia, { kind: 'video' }>;
  hasCaption: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useVisiblePlayback(videoRef);
  const frame = getMediaGeometry({ ...media, hasCaption, isVideo: true });
  const width = media.isRound ? ROUND_VIDEO_SIZE : frame.width;
  const height = media.isRound ? ROUND_VIDEO_SIZE : frame.height;

  return (
    <div
      className={styles.videoFrame}
      data-round={media.isRound}
      style={{ width, aspectRatio: `${width} / ${height}` }}
    >
      <video
        ref={videoRef}
        src={media.url}
        poster={media.poster}
        width={media.width}
        height={media.height}
        controls
        playsInline
        preload="none"
        aria-label={media.isRound ? 'Video message' : 'Shared video'}
      />
    </div>
  );
}
