import { MAX_ATTACHMENT_BYTES, type Attachment } from '../model';

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
]);

function readFileUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read this file. Please try another file.'));
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

  const url = await readFileUrl(file);
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

/** Store a bounded local document without changing its original bytes or media type. */
export async function createDocumentAttachment(file: File) {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Choose a file smaller than 8 MB.');
  }
  return {
    kind: 'document' as const,
    name: file.name,
    url: await readFileUrl(file),
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
  };
}

/** Read video dimensions before adding a measured video bubble to the history. */
export async function createVideoAttachment(file: File) {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Choose a video smaller than 8 MB.');
  }
  const url = await readFileUrl(file);
  const video = document.createElement('video');
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not open this video.'));
      video.preload = 'metadata';
      video.src = url;
    });
    const hasValidDimensions = video.videoWidth > 0 && video.videoHeight > 0;
    const hasValidDuration = Number.isFinite(video.duration) && video.duration > 0;
    if (!hasValidDimensions || !hasValidDuration) {
      throw new Error('This video has no usable dimensions or duration.');
    }
    return {
      kind: 'video' as const,
      url,
      poster: '',
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
