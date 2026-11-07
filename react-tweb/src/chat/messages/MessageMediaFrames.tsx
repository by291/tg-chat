import type { CSSProperties } from 'react';
import { createAlbumPhoto } from '../media/photoGallery';
import { getAlbumLayout, type AlbumLayout } from '../media/albumLayout';
import { rememberPhotoSource } from '../media/mediaViewerTransition';
import { PhotoBackdrop } from './PhotoBackdrop';
import { useDeferredMediaSource } from './deferredMedia';
import { getPhotoGeometry } from '../media/mediaGeometry';
import type { PhotoAttachment } from '../messageMedia';
import type { Message } from '../model';
import styles from './MessageBody.module.css';

export { VideoFrame } from './VideoMessage';

const DESKTOP_ALBUM_WIDTH = 420;
const MOBILE_ALBUM_WIDTH = 340;
const PERCENTAGE_SCALE = 100;

interface PhotoFrameProps {
  messageId: string;
  photo: PhotoAttachment;
  hasCaption: boolean;
  onOpen: () => void;
}

/** Reserve the photo frame independently of the image loading lifecycle. */
export function PhotoFrame({ messageId, photo, hasCaption, onOpen }: PhotoFrameProps) {
  const source = useDeferredMediaSource(photo.url);
  const desktopFrame = getPhotoGeometry({ ...photo, hasCaption });
  const mobileFrame = getPhotoGeometry({
    ...photo,
    hasCaption,
    isMobile: true,
  });
  const borderWidth = 2;
  const desktopImageWidth = (desktopFrame.imageWidth / (desktopFrame.width - borderWidth)) * 100;
  const mobileImageWidth = (mobileFrame.imageWidth / (mobileFrame.width - borderWidth)) * 100;
  const hasBackdrop = desktopFrame.isFitted || mobileFrame.isFitted;
  const frameStyle = {
    '--photo-width': `${desktopFrame.width}px`,
    '--photo-ratio': `${desktopFrame.width} / ${desktopFrame.height}`,
    '--photo-image-width': `${desktopImageWidth}%`,
    '--photo-mobile-width': `${mobileFrame.width}px`,
    '--photo-mobile-ratio': `${mobileFrame.width} / ${mobileFrame.height}`,
    '--photo-mobile-image-width': `${mobileImageWidth}%`,
  } as CSSProperties;

  return (
    <button
      className={styles.photoFrame}
      data-photo-id={messageId}
      style={frameStyle}
      onClick={(event) => {
        rememberPhotoSource(messageId, event.currentTarget);
        onOpen();
      }}
      aria-label={`Open image: ${photo.name}`}
    >
      {hasBackdrop && <PhotoBackdrop source={source} />}
      <img
        className={styles.photoImage}
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

function getAlbumTileStyle({
  desktopLayout,
  mobileLayout,
  index,
}: {
  desktopLayout: AlbumLayout;
  mobileLayout: AlbumLayout;
  index: number;
}): CSSProperties {
  const desktopTile = desktopLayout.items[index];
  const mobileTile = mobileLayout.items[index];

  return {
    '--tile-left': `${(desktopTile.left / desktopLayout.width) * PERCENTAGE_SCALE}%`,
    '--tile-top': `${(desktopTile.top / desktopLayout.height) * PERCENTAGE_SCALE}%`,
    '--tile-width': `${(desktopTile.width / desktopLayout.width) * PERCENTAGE_SCALE}%`,
    '--tile-height': `${(desktopTile.height / desktopLayout.height) * PERCENTAGE_SCALE}%`,
    '--tile-mobile-left': `${(mobileTile.left / mobileLayout.width) * PERCENTAGE_SCALE}%`,
    '--tile-mobile-top': `${(mobileTile.top / mobileLayout.height) * PERCENTAGE_SCALE}%`,
    '--tile-mobile-width': `${(mobileTile.width / mobileLayout.width) * PERCENTAGE_SCALE}%`,
    '--tile-mobile-height': `${(mobileTile.height / mobileLayout.height) * PERCENTAGE_SCALE}%`,
  } as CSSProperties;
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
  const desktopLayout = getAlbumLayout({ items: photos, maxWidth: DESKTOP_ALBUM_WIDTH });
  const mobileLayout = getAlbumLayout({ items: photos, maxWidth: MOBILE_ALBUM_WIDTH });
  const albumStyle = {
    '--album-width': `${desktopLayout.width}px`,
    '--album-ratio': `${desktopLayout.width} / ${desktopLayout.height}`,
    '--album-mobile-width': `${mobileLayout.width}px`,
    '--album-mobile-ratio': `${mobileLayout.width} / ${mobileLayout.height}`,
  } as CSSProperties;

  return (
    <div className={styles.album} style={albumStyle}>
      {photos.map((photo, index) => (
        <button
          key={`${photo.url}-${index}`}
          style={getAlbumTileStyle({
            desktopLayout,
            mobileLayout,
            index,
          })}
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
