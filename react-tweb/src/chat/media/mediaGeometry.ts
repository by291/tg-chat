const MAX_MEDIA_WIDTH = 420;
const MAX_MEDIA_HEIGHT = 400;
const MIN_MEDIA_SIDE = 200;
const MIN_PHOTO_WIDTH = 120;
const MIN_VIDEO_WIDTH = 368;
const MIN_CAPTION_WIDTH = 320;
const MIN_RENDERED_SIDE = 1;

interface MediaGeometryOptions {
  width: number;
  height: number;
  hasCaption: boolean;
  isVideo?: boolean;
  availableWidth?: number;
}

function fitMediaImage({ width, height }: Pick<MediaGeometryOptions, 'width' | 'height'>) {
  const fitScale = Math.min(MAX_MEDIA_WIDTH / width, MAX_MEDIA_HEIGHT / height, 1);
  let frameWidth = Math.max(MIN_RENDERED_SIDE, Math.floor(width * fitScale));
  let frameHeight = Math.max(MIN_RENDERED_SIDE, Math.floor(height * fitScale));

  if (frameWidth < MIN_MEDIA_SIDE && frameHeight < MIN_MEDIA_SIDE) {
    const enlargement = MIN_MEDIA_SIDE / Math.max(frameWidth, frameHeight);
    frameWidth = Math.floor(frameWidth * enlargement);
    frameHeight = Math.floor(frameHeight * enlargement);
  }

  return { width: frameWidth, height: frameHeight };
}

/** Reserve a tweb-style media box before loading or decoding the resource. */
export function getMediaGeometry({
  width,
  height,
  hasCaption,
  isVideo = false,
  availableWidth = MAX_MEDIA_WIDTH,
}: MediaGeometryOptions) {
  const fittedImage = fitMediaImage({ width, height });

  // A caption needs a readable line length even when the source is a narrow portrait.
  const minimumWidth = isVideo ? MIN_VIDEO_WIDTH : MIN_PHOTO_WIDTH;
  const frameWidth = Math.max(fittedImage.width, minimumWidth, hasCaption ? MIN_CAPTION_WIDTH : 0);
  const viewportScale = Math.min(1, availableWidth / frameWidth);

  return {
    width: Math.max(MIN_RENDERED_SIDE, Math.round(frameWidth * viewportScale)),
    height: Math.max(MIN_RENDERED_SIDE, Math.round(fittedImage.height * viewportScale)),
  };
}

/** Keep a photo's complete aspect ratio inside a frame widened for its caption or reply. */
export function getPhotoGeometry(options: MediaGeometryOptions) {
  const frame = getMediaGeometry(options);
  const fittedImage = fitMediaImage(options);
  const viewportScale = frame.height / fittedImage.height;
  const imageWidth = Math.max(
    MIN_RENDERED_SIDE,
    Math.min(frame.width, Math.round(fittedImage.width * viewportScale)),
  );

  return {
    ...frame,
    imageWidth,
    isFitted: imageWidth < frame.width,
  };
}
