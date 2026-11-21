import { createAlbumPhoto } from '@/features/media/photoGallery';
import { AlbumLayoutFrame, photoFramePresentation } from './VisualMediaLayout';
import { rememberPhotoSource } from '@/features/media/mediaViewerTransition';
import { PhotoBackdrop } from './PhotoBackdrop';
import { useDeferredMediaSource } from './deferredMedia';
import type { PhotoAttachment } from '@/domain/messages/media';
import type { Message } from '@/domain/messages/message';
import styles from '../MessageBody.module.css';

export { VideoFrame } from './VideoMessage';

interface PhotoFrameProps {
  messageId: string;
  photo: PhotoAttachment;
  hasCaption: boolean;
  onOpen: () => void;
  onImageError?: () => void;
}

/** Reserve the photo frame independently of the image loading lifecycle. */
export function PhotoFrame({
  messageId,
  photo,
  hasCaption,
  onOpen,
  onImageError,
}: PhotoFrameProps) {
  const source = useDeferredMediaSource(photo.url || undefined);
  const frame = photoFramePresentation({ ...photo, hasCaption });

  return (
    <button
      className={styles.photoFrame}
      data-photo-id={messageId}
      style={frame.style}
      onClick={(event) => {
        rememberPhotoSource(messageId, event.currentTarget);
        onOpen();
      }}
      aria-label={`Open image: ${photo.name}`}
    >
      {frame.hasBackdrop && <PhotoBackdrop source={source} />}
      <img
        className={styles.photoImage}
        src={source}
        onError={onImageError}
        crossOrigin={onImageError ? 'anonymous' : undefined}
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
  const tiles = photos.map((photo, index) => {
    const selected = createAlbumPhoto(message, photo, index);
    return {
      id: selected.id,
      width: photo.width,
      height: photo.height,
      content: (
        <button
          data-photo-id={selected.id}
          aria-label={`Open album photo ${index + 1}: ${photo.name}`}
          onClick={(event) => {
            rememberPhotoSource(selected.id, event.currentTarget);
            onOpenMedia(selected);
          }}
        >
          <AlbumPhoto photo={photo} />
        </button>
      ),
    };
  });
  return <AlbumLayoutFrame tiles={tiles} />;
}
