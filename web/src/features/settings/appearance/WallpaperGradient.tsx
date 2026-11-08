import { useLayoutEffect, useRef } from 'react';
import { GRADIENT_SIZE, renderGradientPixels } from './freeformGradient';
import styles from './ChatWallpaper.module.css';

/** Paint the same wallpaper raster in full-size backgrounds and miniature theme previews. */
export function WallpaperGradient({ colors }: { colors?: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorKey = colors?.join(',');
  useLayoutEffect(() => {
    if (!colorKey || typeof CanvasRenderingContext2D === 'undefined') {
      return;
    }
    const context = canvasRef.current?.getContext('2d');
    if (!context) {
      return;
    }
    const pixels = renderGradientPixels(colorKey.split(','));
    context.putImageData(new ImageData(pixels, GRADIENT_SIZE, GRADIENT_SIZE), 0, 0);
  }, [colorKey]);
  if (!colors) {
    return null;
  }
  return (
    <canvas
      ref={canvasRef}
      width={GRADIENT_SIZE}
      height={GRADIENT_SIZE}
      className={styles.gradient}
      aria-hidden="true"
    />
  );
}
