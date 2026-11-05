const MAX_MEDIA_WIDTH = 420;
const MAX_MEDIA_HEIGHT = 400;
const MIN_MEDIA_SIDE = 200;
const MIN_PHOTO_WIDTH = 120;
const MIN_VIDEO_WIDTH = 368;
const MIN_CAPTION_WIDTH = 320;

interface MediaGeometryOptions {
  width: number;
  height: number;
  hasCaption: boolean;
  isVideo?: boolean;
  availableWidth?: number;
}

/** Reserve a tweb-style media box before loading or decoding the resource. */
export function getMediaGeometry({
  width,
  height,
  hasCaption,
  isVideo = false,
  availableWidth = MAX_MEDIA_WIDTH,
}: MediaGeometryOptions) {
  const fitScale = Math.min(MAX_MEDIA_WIDTH / width, MAX_MEDIA_HEIGHT / height, 1);
  let frameWidth = Math.round(width * fitScale);
  let frameHeight = Math.round(height * fitScale);

  if (frameWidth < MIN_MEDIA_SIDE && frameHeight < MIN_MEDIA_SIDE) {
    const enlargement = MIN_MEDIA_SIDE / Math.max(frameWidth, frameHeight);
    frameWidth = Math.round(frameWidth * enlargement);
    frameHeight = Math.round(frameHeight * enlargement);
  }

  // A caption needs a readable line length even when the source is a narrow portrait.
  const minimumWidth = isVideo ? MIN_VIDEO_WIDTH : MIN_PHOTO_WIDTH;
  frameWidth = Math.max(frameWidth, minimumWidth, hasCaption ? MIN_CAPTION_WIDTH : 0);
  const viewportScale = Math.min(1, availableWidth / frameWidth);

  return {
    width: Math.round(frameWidth * viewportScale),
    height: Math.round(frameHeight * viewportScale),
  };
}
