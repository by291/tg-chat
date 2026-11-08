const OPEN_DURATION = 200;
export const SLIDE_DURATION = 350;
const CLIPPING_ANCESTOR_LIMIT = 2;
const FRAME_BORDER_TOLERANCE = 1;

interface PhotoTransitionOptions {
  image: HTMLElement;
  source: HTMLElement | null;
  isOpening: boolean;
  shouldReduceMotion: boolean;
  startFrame?: Keyframe;
}

let clickedPhotoSource: { messageId: string; element: HTMLElement } | undefined;

function readRestingMediaBounds(image: HTMLElement) {
  const layer = image.closest<HTMLElement>('[data-viewer-transform]');
  if (!layer) {
    return image.getBoundingClientRect();
  }
  // Closing animates the outer zoom/rotation back independently. The thumbnail path belongs
  // to its untransformed layout, otherwise the outer scale would be applied twice.
  const transform = layer.style.transform;
  const transition = layer.style.transition;
  layer.style.transition = 'none';
  layer.style.transform = 'none';
  const bounds = image.getBoundingClientRect();
  layer.style.transform = transform;
  // Closing must capture the restored presentation, not a transition started by measurement.
  layer.getBoundingClientRect();
  layer.style.transition = transition;
  return bounds;
}

/** Record the clicked copy because mouse clicks do not focus buttons in every browser. */
export function rememberPhotoSource(messageId: string, element: HTMLElement) {
  clickedPhotoSource = { messageId, element };
}

function getScaledCorners(source: HTMLElement, scale: number) {
  const bounds = source.getBoundingClientRect();
  const corners = [
    'borderTopLeftRadius',
    'borderTopRightRadius',
    'borderBottomRightRadius',
    'borderBottomLeftRadius',
  ] as const;
  const radii = corners.map((corner) => parseFloat(getComputedStyle(source)[corner]) || 0);
  let parent = source.parentElement;
  for (let depth = 0; parent && depth < CLIPPING_ANCESTOR_LIMIT; depth += 1) {
    const outer = parent.getBoundingClientRect();
    const edges = [
      Math.abs(bounds.left - outer.left) <= FRAME_BORDER_TOLERANCE &&
        Math.abs(bounds.top - outer.top) <= FRAME_BORDER_TOLERANCE,
      Math.abs(bounds.right - outer.right) <= FRAME_BORDER_TOLERANCE &&
        Math.abs(bounds.top - outer.top) <= FRAME_BORDER_TOLERANCE,
      Math.abs(bounds.right - outer.right) <= FRAME_BORDER_TOLERANCE &&
        Math.abs(bounds.bottom - outer.bottom) <= FRAME_BORDER_TOLERANCE,
      Math.abs(bounds.left - outer.left) <= FRAME_BORDER_TOLERANCE &&
        Math.abs(bounds.bottom - outer.bottom) <= FRAME_BORDER_TOLERANCE,
    ];
    const parentStyle = getComputedStyle(parent);
    const hasClip = parentStyle.overflow === 'hidden';
    for (let index = 0; index < corners.length; index += 1) {
      const inheritedRadius =
        hasClip && edges[index] ? parseFloat(parentStyle[corners[index]]) || 0 : 0;
      radii[index] = Math.max(radii[index], inheritedRadius);
    }
    parent = parent.parentElement;
  }
  return radii.map((radius) => `${radius / scale}px`).join(' ');
}

/** Resolve a visible thumbnail without retaining a virtual history row. */
export function findPhotoSource(messageId: string): HTMLElement | null {
  const clickedSource = clickedPhotoSource;
  clickedPhotoSource = undefined;
  if (clickedSource?.messageId === messageId && clickedSource.element.isConnected) {
    return clickedSource.element;
  }
  const focusedSource = document.activeElement?.closest<HTMLElement>('[data-photo-id]');
  if (focusedSource?.dataset.photoId === messageId) {
    return focusedSource;
  }
  const candidates = document.querySelectorAll<HTMLElement>('[data-photo-id]');
  for (const candidate of candidates) {
    if (candidate.dataset.photoId !== messageId) {
      continue;
    }
    const bounds = candidate.getBoundingClientRect();
    const isVisible =
      bounds.bottom > 0 &&
      bounds.top < window.innerHeight &&
      bounds.right > 0 &&
      bounds.left < window.innerWidth &&
      bounds.width > 0;
    if (isVisible) {
      return candidate;
    }
  }
  return null;
}

/** Animate a photo between its thumbnail and full size without changing history geometry. */
export function animateViewerPhoto({
  image,
  source,
  isOpening,
  shouldReduceMotion,
  startFrame,
}: PhotoTransitionOptions) {
  if (shouldReduceMotion || !image.animate) {
    return undefined;
  }
  const destination = readRestingMediaBounds(image);
  const sourceImage = source?.querySelector<HTMLElement>('video, img:not([aria-hidden])');
  const origin = sourceImage?.getBoundingClientRect();
  if (!origin || !destination.width || !destination.height) {
    return image.animate(
      [startFrame ?? { opacity: isOpening ? 0 : 1 }, { opacity: isOpening ? 1 : 0 }],
      {
        duration: OPEN_DURATION,
        easing: 'ease',
        fill: 'both',
      },
    );
  }

  // A cover-cropped tile expands with a clip, keeping the photo's aspect ratio throughout.
  const scale = Math.max(origin.width / destination.width, origin.height / destination.height);
  const insetHorizontal = Math.max(0, (destination.width - origin.width / scale) / 2);
  const insetVertical = Math.max(0, (destination.height - origin.height / scale) / 2);
  const offsetLeft = origin.left + origin.width / 2 - destination.left - destination.width / 2;
  const offsetTop = origin.top + origin.height / 2 - destination.top - destination.height / 2;
  const radius = sourceImage ? getScaledCorners(sourceImage, scale) : '0px';
  const thumbnail = {
    transform: `translate(${offsetLeft}px, ${offsetTop}px) scale(${scale})`,
    clipPath: `inset(${insetVertical}px ${insetHorizontal}px round ${radius})`,
  };
  const expanded = { transform: 'translate(0px, 0px) scale(1)', clipPath: 'inset(0px round 0px)' };

  return image.animate(isOpening ? [thumbnail, expanded] : [startFrame ?? expanded, thumbnail], {
    duration: OPEN_DURATION,
    easing: 'ease',
    fill: 'both',
  });
}

/** Slide the next gallery photo in from the direction of navigation. */
export function animateGallerySlide({
  image,
  direction,
  isEntering = true,
}: {
  image: HTMLElement;
  direction: number;
  isEntering?: boolean;
}) {
  const bounds = image.getBoundingClientRect();
  const movesFromRight = direction > 0;
  const rightOffset = window.innerWidth - bounds.left;
  const leftOffset = -bounds.right;
  const incomingOffset = movesFromRight ? rightOffset : leftOffset;
  const outgoingOffset = movesFromRight ? leftOffset : rightOffset;
  const centered = { transform: 'translateX(0)' };
  const outside = {
    transform: `translateX(${isEntering ? incomingOffset : outgoingOffset}px)`,
  };
  return image.animate?.(isEntering ? [outside, centered] : [centered, outside], {
    duration: SLIDE_DURATION,
    easing: 'ease',
    fill: 'both',
  });
}
