import { MAX_ATTACHMENT_BYTES, type Attachment } from './model';

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
]);

function readImageUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read this image. Please try another file.'));
    reader.readAsDataURL(file);
  });
}

/** Decode a bounded local image before reserving its size in the conversation. */
export async function createAttachment(file: File): Promise<Attachment> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Choose a PNG, JPEG, WebP, GIF, or AVIF image.');
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Choose an image smaller than 8 MB.');
  }

  const url = await readImageUrl(file);
  const image = new Image();
  image.src = url;
  await image.decode();

  return {
    name: file.name,
    url,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}
