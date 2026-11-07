import { createAlbumPhoto } from '../media/photoGallery';
import { rememberPhotoSource } from '../media/mediaViewerTransition';
import { PhotoBackdrop } from './PhotoBackdrop';
import { useRef } from 'react';
import { useDeferredMediaSource } from './deferredMedia';
import { useVisiblePlayback } from './useVisiblePlayback';
import { getMediaGeometry, getPhotoGeometry } from '../media/mediaGeometry';
import type { MessageMedia, PhotoAttachment } from '../messageMedia';
import type { Message } from '../model';
import styles from './MessageBody.module.css';

const ROUND_VIDEO_SIZE = 240;

interface PhotoFrameProps {
  messageId: string;
  photo: PhotoAttachment;
  hasCaption: boolean;
  onOpen: () => void;
}

/** Reserve the photo frame independently of the image loading lifecycle. */
export function PhotoFrame({ messageId, photo, hasCaption, onOpen }: PhotoFrameProps) {
  const source = useDeferredMediaSource(photo.url);
  const frame = getPhotoGeometry({ ...photo, hasCaption });
  const borderWidth = 2;
  const imageWidth = (frame.imageWidth / (frame.width - borderWidth)) * 100;

  return (
    <button
      className={styles.photoFrame}
      data-photo-id={messageId}
      data-fitted={frame.isFitted}
      style={{ width: frame.width, aspectRatio: `${frame.width} / ${frame.height}` }}
      onClick={(event) => {
        rememberPhotoSource(messageId, event.currentTarget);
        onOpen();
      }}
      aria-label={`Open image: ${photo.name}`}
    >
      {frame.isFitted && <PhotoBackdrop source={source} />}
      <img
        className={styles.photoImage}
        style={frame.isFitted ? { width: `${imageWidth}%` } : undefined}
        src={source}
        alt={photo.name}
        width={photo.width}
        height={photo.height}
        loading="lazy"
        decoding="async"
      />
    </button>
  );
}

function AlbumPhoto({ photo }: { photo: PhotoAttachment }) {
  const source = useDeferredMediaSource(photo.url);
  return (
    <img
      src={source}
      alt={photo.name}
      width={photo.width}
      height={photo.height}
      loading="lazy"
      decoding="async"
    />
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
          data-photo-id={createAlbumPhoto(message, photo, index).id}
          aria-label={`Open album photo ${index + 1}: ${photo.name}`}
          onClick={(event) => {
            const selectedPhoto = createAlbumPhoto(message, photo, index);
            rememberPhotoSource(selectedPhoto.id, event.currentTarget);
            onOpenMedia(selectedPhoto);
          }}
        >
          <AlbumPhoto photo={photo} />
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
  const poster = useDeferredMediaSource(media.poster);
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
        poster={poster}
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
