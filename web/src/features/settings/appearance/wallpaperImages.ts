import { del, get, set } from 'idb-keyval';

const MAXIMUM_IMAGE_EDGE = 2560;
const MAXIMUM_UPLOAD_BYTES = 20 * 1024 * 1024;
const JPEG_QUALITY = 0.9;
const IMAGE_KEY_PREFIX = 'react-tweb.wallpaper.';
// prettier-ignore
const SUPPORTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/** Validate and resize a local wallpaper before storing its browser-independent bytes. */
export async function prepareWallpaperImage(file: File): Promise<Blob> {
  if (!SUPPORTED_TYPES.has(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  if (file.size > MAXIMUM_UPLOAD_BYTES) {
    throw new Error('Choose an image smaller than 20 MB.');
  }

  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This image could not be opened.');
  }

  try {
    const scale = Math.min(1, MAXIMUM_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('This image could not be processed.');
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('This image could not be processed.'));
          }
        },
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}

/** Save an uploaded background before publishing its identifier to other tabs. */
export async function saveWallpaperImage(file: File) {
  const blob = await prepareWallpaperImage(file);
  const imageId = crypto.randomUUID();

  try {
    await set(`${IMAGE_KEY_PREFIX}${imageId}`, blob);
  } catch {
    throw new Error(
      'Could not save this wallpaper. Check available browser storage and try again.',
    );
  }

  return imageId;
}

/** Release a prepared image that was superseded before it could become a wallpaper. */
export function discardWallpaperImage(imageId: string) {
  return del(`${IMAGE_KEY_PREFIX}${imageId}`);
}

/** Load persisted wallpaper bytes without storing temporary object URLs in preferences. */
export function readWallpaperImage(imageId: string) {
  return get<Blob>(`${IMAGE_KEY_PREFIX}${imageId}`);
}
