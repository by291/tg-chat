import { useEffect, useState } from 'react';
import type { ThemeChoice, ThemeVariant } from './appearanceStore';
import { getWallpaperAppearance } from './themeCatalog';
import { readWallpaperImage } from './wallpaperImages';
import { showToast } from '../../components/toastStore';
import { WallpaperGradient } from './WallpaperGradient';
import styles from './ChatWallpaper.module.css';

/** Render the chat background separately so theme changes cannot affect message geometry. */
export function ChatWallpaper({ variant, choice }: { variant: ThemeVariant; choice: ThemeChoice }) {
  const wallpaper = choice.wallpaper;
  const imageId = wallpaper?.kind === 'image' ? wallpaper.imageId : undefined;
  const [image, setImage] = useState<{ id: string; url: string }>();
  const appearance = getWallpaperAppearance({ variant, choice });
  const isBlurred = wallpaper?.kind === 'image' && wallpaper.isBlurred;
  const imageUrl = image?.id === imageId ? image?.url : undefined;

  useEffect(() => {
    if (!imageId) {
      return;
    }
    const requestedImageId = imageId;
    let isCancelled = false;
    let objectUrl: string | undefined;
    async function loadImage() {
      try {
        const blob = await readWallpaperImage(requestedImageId);
        if (isCancelled) {
          return;
        }
        if (!blob) {
          throw new Error('Wallpaper unavailable');
        }
        objectUrl = URL.createObjectURL(blob);
        setImage({ id: requestedImageId, url: objectUrl });
      } catch {
        if (!isCancelled) {
          showToast('This wallpaper is unavailable. Choose another image or reset the background.');
        }
      }
    }
    void loadImage();
    return () => {
      // A late IndexedDB result must not install a stale image after a theme change.
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
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
