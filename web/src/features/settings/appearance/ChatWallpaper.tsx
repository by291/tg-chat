import { useLayoutEffect, useState } from 'react';
import type { ThemeChoice, ThemeVariant } from './appearanceStore';
import { getWallpaperAppearance } from './themeCatalog';
import { acquireWallpaperImage, getPreparedWallpaperUrl } from './wallpaperImageResources';
import { showToast } from '@/components/toastStore';
import { WallpaperGradient } from './WallpaperGradient';
import styles from './ChatWallpaper.module.css';

/** Render the chat background separately so theme changes cannot affect message geometry. */
export function ChatWallpaper({ variant, choice }: { variant: ThemeVariant; choice: ThemeChoice }) {
  const wallpaper = choice.wallpaper;
  const imageId = wallpaper?.kind === 'image' ? wallpaper.imageId : undefined;
  const [image, setImage] = useState<{ id: string; url: string }>();
  const appearance = getWallpaperAppearance({ variant, choice });
  const isBlurred = wallpaper?.kind === 'image' && wallpaper.isBlurred;
  const previousUrl = image?.id === imageId ? image?.url : undefined;
  const imageUrl = getPreparedWallpaperUrl(imageId) ?? previousUrl;

  useLayoutEffect(() => {
    if (!imageId) {
      return;
    }

    const requestedImageId = imageId;
    const resource = acquireWallpaperImage(requestedImageId);
    let isCancelled = false;
    void resource.ready
      .then(() => {
        const url = getPreparedWallpaperUrl(requestedImageId);
        if (!isCancelled && url) {
          setImage({ id: requestedImageId, url });
        }
      })
      .catch(() => {
        if (!isCancelled) {
          showToast('This wallpaper is unavailable. Choose another image or reset the background.');
        }
      });

    return () => {
      isCancelled = true;
      resource.release();
    };
  }, [imageId]);

  return (
    <div
      className={styles.wallpaper}
      style={{ background: appearance.background }}
      data-pattern={appearance.hasPattern && !imageUrl}
      aria-hidden="true"
    >
      {!imageUrl && <WallpaperGradient colors={appearance.colors} />}
      {imageUrl && <img src={imageUrl} alt="" data-blurred={isBlurred} />}
    </div>
  );
}
