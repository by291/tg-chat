import type { CSSProperties, ReactNode } from 'react';
import { getAlbumLayout, type AlbumLayout } from '@/features/media/albumLayout';
import { getPhotoGeometry } from '@/features/media/mediaGeometry';
import styles from '../MessageBody.module.css';

const DESKTOP_ALBUM_WIDTH = 420;
const MOBILE_ALBUM_WIDTH = 340;
const FRAME_BORDER_WIDTH = 2;
const PERCENTAGE_SCALE = 100;

interface AlbumTile {
  id: string;
  width: number;
  height: number;
  content: ReactNode;
}

/** Reserve the same responsive photo or video box throughout loading and upload. */
export function photoFramePresentation(options: {
  width: number;
  height: number;
  hasCaption: boolean;
}) {
  const desktopFrame = getPhotoGeometry(options);
  const mobileFrame = getPhotoGeometry({
    ...options,
    isMobile: true,
  });
  const desktopImageWidth =
    (desktopFrame.imageWidth / (desktopFrame.width - FRAME_BORDER_WIDTH)) * PERCENTAGE_SCALE;
  const mobileImageWidth =
    (mobileFrame.imageWidth / (mobileFrame.width - FRAME_BORDER_WIDTH)) * PERCENTAGE_SCALE;
  const hasBackdrop = desktopFrame.isFitted || mobileFrame.isFitted;
  const frameStyle = {
    '--photo-width': `${desktopFrame.width}px`,
    '--photo-ratio': `${desktopFrame.width} / ${desktopFrame.height}`,
    '--photo-image-width': `${desktopImageWidth}%`,
    '--photo-mobile-width': `${mobileFrame.width}px`,
    '--photo-mobile-ratio': `${mobileFrame.width} / ${mobileFrame.height}`,
    '--photo-mobile-image-width': `${mobileImageWidth}%`,
  } as CSSProperties;

  return { style: frameStyle, hasBackdrop };
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

/** Lay out local and authorized album occurrences at their actual aspect ratios. */
export function AlbumLayoutFrame({
  tiles,
  maximumWidth,
}: {
  tiles: AlbumTile[];
  maximumWidth?: number;
}) {
  const desktopLayout = getAlbumLayout({
    items: tiles,
    maxWidth: maximumWidth ?? DESKTOP_ALBUM_WIDTH,
  });
  const mobileLayout = getAlbumLayout({
    items: tiles,
    maxWidth: maximumWidth ?? MOBILE_ALBUM_WIDTH,
  });
  const albumStyle = {
    '--album-width': `${desktopLayout.width}px`,
    '--album-ratio': `${desktopLayout.width} / ${desktopLayout.height}`,
    '--album-mobile-width': `${mobileLayout.width}px`,
    '--album-mobile-ratio': `${mobileLayout.width} / ${mobileLayout.height}`,
  } as CSSProperties;

  return (
    <div className={styles.album} style={albumStyle}>
      {tiles.map((tile, index) => (
        <div
          key={tile.id}
          className={styles.albumTile}
          style={getAlbumTileStyle({
            desktopLayout,
            mobileLayout,
            index,
          })}
        >
          {tile.content}
        </div>
      ))}
    </div>
  );
}
