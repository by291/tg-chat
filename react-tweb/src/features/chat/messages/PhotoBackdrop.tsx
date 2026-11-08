import { useEffect, useRef } from 'react';
import styles from './MessageBody.module.css';

const THUMBNAIL_SIDE = 40;
// Telegram's stripped JPEG header uses the standard quality-20 quantization tables.
const THUMBNAIL_JPEG_QUALITY = 0.2;
const BLUR_RADIUS = 2;
const BLUR_OVERDRAW = BLUR_RADIUS * 2;

function loadPhotoImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Photo thumbnail could not be decoded'));
    image.src = source;
  });
}

function encodePhotoThumbnail(image: HTMLImageElement) {
  const thumbnail = document.createElement('canvas');
  const scale = Math.min(1, THUMBNAIL_SIDE / Math.max(image.width, image.height));
  thumbnail.width = Math.max(1, Math.round(image.width * scale));
  thumbnail.height = Math.max(1, Math.round(image.height * scale));
  const context = thumbnail.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('Photo thumbnail canvas is unavailable');
  }

  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, thumbnail.width, thumbnail.height);
  return thumbnail.toDataURL('image/jpeg', THUMBNAIL_JPEG_QUALITY);
}

function drawBlurredThumbnail(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    return;
  }

  canvas.width = image.width;
  canvas.height = image.height;
  context.filter = `blur(${BLUR_RADIUS}px)`;
  context.drawImage(
    image,
    -BLUR_OVERDRAW,
    -BLUR_OVERDRAW,
    canvas.width + BLUR_OVERDRAW * 2,
    canvas.height + BLUR_OVERDRAW * 2,
  );
}

/** Reproduce the stripped-thumbnail blur used behind Telegram's fitted photos. */
export function PhotoBackdrop({ source }: { source?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!source || !canvas) {
      return;
    }
    let isDisposed = false;

    async function renderBackdrop() {
      try {
        const image = await loadPhotoImage(source!);
        const thumbnail = await loadPhotoImage(encodePhotoThumbnail(image));
        if (!isDisposed) {
          drawBlurredThumbnail(canvas!, thumbnail);
        }
      } catch {
        // A failed decorative thumbnail must not prevent opening or reading the original photo.
      }
    }

    void renderBackdrop();

    return () => {
      isDisposed = true;
    };
  }, [source]);

  return <canvas ref={canvasRef} className={styles.photoBackdrop} aria-hidden="true" />;
}
