import { readReactionLayoutDestination } from './reactionLayoutTransition';
import { resolveReactionEmoji } from './reactionEmoji';
import type { CustomEmoji } from '../emoji/customEmojiCatalog';
import styles from './reactionFlight.module.css';

const FLIGHT_DURATION_MS = 300;
const HOLD_TIMEOUT_MS = 1000;
const COMPLETION_TIMEOUT_MS = 7000;
const ELEVATION_PX = 30;
const NEAR_DISTANCE_PX = 5;
const PATH_STEPS = 16;
const CHIP_DURATION_MS = 250;
const CHIP_INITIAL_SCALE = 0.5;
const CHIP_SCALE_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)';
const CHIP_FADE_DURATION_MS = 150;
const GROWING_CHIP_FADE_START_MS = 90;
const GROWING_CHIP_FADE_END_MS = 190;
const SIZE_TOLERANCE_PX = 0.5;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

interface HoldOptions {
  messageId: string;
  emoji: string;
  source: HTMLElement;
  targetRow: HTMLElement;
}

interface LaunchOptions {
  messageId: string;
  emoji: string;
  target: HTMLElement;
}

interface ReactionFlight extends HoldOptions {
  element: HTMLElement;
  picture: HTMLElement;
  origin: DOMRect;
  bubbleRectangle?: DOMRect;
  sourceVisibility: string;
  history: HTMLElement;
  historyScrollTop: number;
  observer: MutationObserver;
  motionPreference?: MediaQueryList;
  onScroll: () => void;
  cancel: () => void;
  timeout: number;
  frame: number;
  animation?: Animation;
  chipAnimations: Animation[];
  target?: HTMLElement;
  targetVisibility?: string;
}

const flights = new Set<ReactionFlight>();
let heldFlight: ReactionFlight | undefined;

function findReaction(row: HTMLElement, emoji: string) {
  const reactions = row.querySelectorAll<HTMLElement>('[data-reaction-emoji]');
  return Array.from(reactions).find((reaction) => reaction.dataset.reactionEmoji === emoji);
}

function finishFlight(flight: ReactionFlight) {
  if (!flights.delete(flight)) {
    return;
  }

  if (heldFlight === flight) {
    heldFlight = undefined;
  }

  window.clearTimeout(flight.timeout);
  window.cancelAnimationFrame(flight.frame);
  flight.animation?.cancel();
  for (const animation of flight.chipAnimations) {
    animation.cancel();
  }
  flight.observer.disconnect();
  flight.history.removeEventListener('scroll', flight.onScroll);
  flight.motionPreference?.removeEventListener?.('change', flight.cancel);
  window.removeEventListener('pagehide', flight.cancel);
  window.removeEventListener('resize', flight.cancel);
  flight.element.remove();
  flight.source.style.visibility = flight.sourceVisibility;
  if (flight.target) {
    flight.target.style.visibility = flight.targetVisibility ?? '';
  }
}

function copyReactionCanvas(source: HTMLCanvasElement) {
  if (!source.width || !source.height) {
    return;
  }

  const snapshot = document.createElement('canvas');
  snapshot.width = source.width;
  snapshot.height = source.height;
  try {
    const context = snapshot.getContext('2d');
    if (!context) {
      return;
    }
    context.drawImage(source, 0, 0);
    return snapshot;
  } catch {
    // A renderer being disposed can lose its drawing surface; the bundled preview remains usable.
    return;
  }
}

function copyCustomReactionPicture(options: { source: HTMLElement; custom: CustomEmoji }) {
  const displayedPreview = options.source.querySelector('img');
  const displayedCanvas = options.source.querySelector('canvas');
  if (!displayedPreview && displayedCanvas) {
    const snapshot = copyReactionCanvas(displayedCanvas);
    if (snapshot) {
      snapshot.className = styles.artwork;
      return snapshot;
    }
  }

  const preview = document.createElement('img');
  preview.className = styles.artwork;
  preview.alt = '';
  preview.draggable = false;
  // SVG players have live renderer ownership; use their existing local preview during the flight.
  preview.src = displayedPreview?.currentSrc || displayedPreview?.src || options.custom.preview;
  preview.addEventListener(
    'error',
    () => preview.replaceWith(document.createTextNode(options.custom.emoji)),
    { once: true },
  );
  return preview;
}

function createPicture(options: HoldOptions) {
  const source =
    options.source.querySelector<HTMLElement>('[data-reaction-emoji]') ?? options.source;
  const origin = source.getBoundingClientRect();
  if (!origin.width || !origin.height) {
    return;
  }

  const element = document.createElement('div');
  element.className = styles.flight;
  element.dataset.reactionFlight = options.messageId;
  element.setAttribute('aria-hidden', 'true');
  element.style.left = `${origin.left}px`;
  element.style.top = `${origin.top}px`;
  element.style.width = `${origin.width}px`;
  element.style.height = `${origin.height}px`;

  const picture = document.createElement('span');
  picture.className = styles.picture;
  const reaction = resolveReactionEmoji(options.emoji);
  if (reaction.custom) {
    picture.append(copyCustomReactionPicture({ source, custom: reaction.custom }));
  } else {
    picture.textContent = reaction.native;
  }
  const sourceStyle = window.getComputedStyle(source);
  const sourceScale = source.offsetHeight ? origin.height / source.offsetHeight : 1;
  const fontSize = Number.parseFloat(sourceStyle.fontSize);
  const lineHeight = Number.parseFloat(sourceStyle.lineHeight);
  picture.style.font = sourceStyle.font;
  // Hover and menu transforms enlarge the glyph without changing its computed font metrics.
  if (Number.isFinite(fontSize)) {
    picture.style.fontSize = `${fontSize * sourceScale}px`;
  }
  if (Number.isFinite(lineHeight)) {
    picture.style.lineHeight = `${lineHeight * sourceScale}px`;
  }
  element.append(picture);
  document.body.append(element);
  return {
    element,
    picture,
    source,
    origin,
  };
}

function watchFlight(flight: ReactionFlight) {
  // A menu may unmount immediately; only the owning row and destination govern this flight.
  flight.observer.observe(document.body, { childList: true, subtree: true });
  flight.history.addEventListener('scroll', flight.onScroll, { passive: true });
  flight.motionPreference?.addEventListener?.('change', flight.cancel);
  window.addEventListener('pagehide', flight.cancel);
  window.addEventListener('resize', flight.cancel);
}

/** Capture a newly chosen emoji until its owning message lays out the destination. */
export function holdReactionFlight(options: HoldOptions) {
  const motionPreference = window.matchMedia?.(REDUCED_MOTION_QUERY);
  const history = options.targetRow.closest<HTMLElement>('[aria-label="Message history"]');
  const canAnimate = typeof options.source.animate === 'function';
  if (!history || !options.targetRow.isConnected || motionPreference?.matches || !canAnimate) {
    return;
  }
  if (findReaction(options.targetRow, options.emoji)) {
    return;
  }

  heldFlight?.cancel();
  const capture = createPicture(options);
  if (!capture) {
    return;
  }

  const cancel = () => finishFlight(flight);
  const observer = new MutationObserver(() => {
    const hasLostTarget = Boolean(flight.target && !flight.targetRow.contains(flight.target));
    if (!flight.targetRow.isConnected || hasLostTarget) {
      cancel();
    }
  });
  const onScroll = () => {
    if (!flight.animation) {
      return;
    }
    const scrollDistance = flight.historyScrollTop - history.scrollTop;
    flight.element.style.translate = `0px ${scrollDistance}px`;
  };
  const flight: ReactionFlight = {
    ...options,
    ...capture,
    bubbleRectangle: options.targetRow
      .querySelector('[data-message-content]')
      ?.getBoundingClientRect(),
    sourceVisibility: capture.source.style.visibility,
    history,
    historyScrollTop: history.scrollTop,
    observer,
    motionPreference,
    onScroll,
    cancel,
    timeout: window.setTimeout(cancel, HOLD_TIMEOUT_MS),
    frame: 0,
    chipAnimations: [],
  };

  flights.add(flight);
  heldFlight = flight;
  capture.source.style.visibility = 'hidden';
  watchFlight(flight);
  return cancel;
}

function createFlightKeyframes(origin: DOMRect, destination: DOMRect) {
  const startMiddle = origin.top + origin.height / 2;
  const endMiddle = destination.top + destination.height / 2;
  const horizontalDistance = destination.left - origin.left;
  const verticalDistance = endMiddle - startMiddle;
  const isNear =
    Math.abs(horizontalDistance) < NEAR_DISTANCE_PX &&
    Math.abs(verticalDistance) < NEAR_DISTANCE_PX;
  const halfwayMiddle = isNear ? (startMiddle + endMiddle) / 2 : startMiddle - ELEVATION_PX;
  const linearCoefficient = 4 * (halfwayMiddle - startMiddle) - verticalDistance;
  const quadraticCoefficient = verticalDistance - linearCoefficient;
  const keyframes: Keyframe[] = [];

  for (let step = 0; step <= PATH_STEPS; step += 1) {
    const progress = step / PATH_STEPS;
    const scaleX = 1 + (destination.width / origin.width - 1) * progress;
    const scaleY = 1 + (destination.height / origin.height - 1) * progress;
    const middle =
      startMiddle + linearCoefficient * progress + quadraticCoefficient * progress * progress;
    const translateY = middle - (origin.height * scaleY) / 2 - origin.top;
    const translateX = horizontalDistance * progress;
    keyframes.push({
      offset: progress,
      transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
    });
  }

  return keyframes;
}

function animateReactionChip(flight: ReactionFlight) {
  const button = flight.target?.closest('button');
  if (!button) {
    return;
  }

  const previousRectangle = flight.bubbleRectangle;
  const currentRectangle = button.closest('[data-message-content]')?.getBoundingClientRect();
  const hasBubbleGrown = Boolean(
    previousRectangle &&
    currentRectangle &&
    (currentRectangle.width > previousRectangle.width + SIZE_TOLERANCE_PX ||
      currentRectangle.height > previousRectangle.height + SIZE_TOLERANCE_PX),
  );
  const fadeStart = hasBubbleGrown ? GROWING_CHIP_FADE_START_MS : 0;
  const fadeEnd = hasBubbleGrown ? GROWING_CHIP_FADE_END_MS : CHIP_FADE_DURATION_MS;

  // TG lays out the final size once, then grows the chip without changing row measurements.
  const scale = button.animate([{ scale: `${CHIP_INITIAL_SCALE}` }, { scale: '1' }], {
    duration: CHIP_DURATION_MS,
    easing: CHIP_SCALE_EASING,
    fill: 'both',
  });
  const opacity = button.animate(
    [
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: fadeStart / CHIP_DURATION_MS },
      { opacity: 1, offset: fadeEnd / CHIP_DURATION_MS },
      { opacity: 1, offset: 1 },
    ],
    {
      duration: CHIP_DURATION_MS,
      easing: 'linear',
      fill: 'both',
    },
  );
  flight.chipAnimations.push(scale, opacity);
}

/** Fly only a pending local selection, leaving historical mounts and preview clones unchanged. */
export function launchReactionFlight({ messageId, emoji, target }: LaunchOptions) {
  const flight = heldFlight;
  const isMatchingSelection = flight?.messageId === messageId && flight.emoji === emoji;
  if (!flight || !isMatchingSelection || !flight.targetRow.contains(target)) {
    return;
  }

  if (!target.isConnected) {
    flight.cancel();
    return;
  }

  heldFlight = undefined;
  window.clearTimeout(flight.timeout);
  flight.target = target;
  flight.targetVisibility = target.style.visibility;
  target.style.visibility = 'hidden';
  flight.historyScrollTop = flight.history.scrollTop;
  flight.element.style.translate = '';
  flight.timeout = window.setTimeout(flight.cancel, COMPLETION_TIMEOUT_MS);
  // Start after layout, so the menu can leave while the captured emoji retains its source position.
  flight.frame = window.requestAnimationFrame(() => {
    // Row measurement and bottom anchoring settle after the child's layout effect.
    const settledDestination = readReactionLayoutDestination({ element: target });
    const viewport = flight.history.getBoundingClientRect();
    const isOutsideHistory =
      settledDestination.bottom <= viewport.top || settledDestination.top >= viewport.bottom;
    const hasDestinationSize = settledDestination.width > 0 && settledDestination.height > 0;
    if (!target.isConnected || !hasDestinationSize || isOutsideHistory) {
      flight.cancel();
      return;
    }
    flight.historyScrollTop = flight.history.scrollTop;
    flight.element.style.translate = '';
    const keyframes = createFlightKeyframes(flight.origin, settledDestination);
    flight.animation = flight.picture.animate(keyframes, {
      duration: FLIGHT_DURATION_MS,
      easing: 'linear',
      fill: 'both',
    });
    // Capture the destination before scaling its parent so the flight lands at its final size.
    animateReactionChip(flight);
    flight.animation.finished.then(flight.cancel, flight.cancel);
  });
}

/** Cancel flights owned by one message row, or all flights when the conversation is disposed. */
export function dropReactionFlights(targetRow?: HTMLElement) {
  for (const flight of flights) {
    if (!targetRow || flight.targetRow === targetRow) {
      flight.cancel();
    }
  }
}
