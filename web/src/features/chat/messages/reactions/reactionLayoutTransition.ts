import { flushSync } from 'react-dom';
import { animateReactionLayoutShape } from './reactionLayoutShape';
import {
  animateReactionLayoutParts,
  captureReactionLayoutParts,
  type ReactionLayoutParts,
} from './reactionLayoutParts';

const TRANSITION_DURATION_MS = 250;
const PENDING_TIMEOUT_MS = 1000;
const FINISH_TIMEOUT_MS = 600;
const POSITION_TOLERANCE = 0.5;
const BOTTOM_TOLERANCE = 1;
const HORIZONTAL_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)';
const VERTICAL_EASING = 'cubic-bezier(0.1992, 0.0106, 0.2792, 0.9103)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

interface HistoryRegistration {
  viewport: HTMLElement;
  measureRow: (row: HTMLElement) => void;
  scrollToEnd: () => void;
}

interface RowPosition {
  element: HTMLElement;
  rectangle: DOMRect;
}

interface ReactionLayoutCapture {
  row: HTMLElement;
  bubble: HTMLElement;
  rectangle: DOMRect;
  neighbors: RowPosition[];
  parts: ReactionLayoutParts;
  shouldFollowLatest: boolean;
  isQueued: boolean;
  isPlaying: boolean;
  settledScrollTop: number;
  settledPositions: Map<HTMLElement, DOMRect>;
  animations: Animation[];
  restoreShape?: () => void;
  timeout: number;
  cancel: () => void;
}

interface ReactionLayoutHistory extends HistoryRegistration {
  capture?: ReactionLayoutCapture;
}

const histories = new WeakMap<HTMLElement, ReactionLayoutHistory>();

function getHistory(row: HTMLElement) {
  const viewport = row.closest<HTMLElement>('[aria-label="Message history"]');
  return viewport ? histories.get(viewport) : undefined;
}

function normalizeRow(row: HTMLElement) {
  return row.closest<HTMLElement>('[data-message-id]');
}

function captureNeighbors(viewport: HTMLElement) {
  const viewportRectangle = viewport.getBoundingClientRect();
  const neighbors: RowPosition[] = [];
  const elements = viewport.querySelectorAll<HTMLElement>(
    '[data-message-row-content], [data-sender-group] > span',
  );
  for (const element of elements) {
    const rectangle = element.getBoundingClientRect();
    const isVisible =
      rectangle.bottom > viewportRectangle.top && rectangle.top < viewportRectangle.bottom;
    if (isVisible) {
      neighbors.push({ element, rectangle });
    }
  }
  return neighbors;
}

function watchCapture(history: ReactionLayoutHistory, capture: ReactionLayoutCapture) {
  const { viewport } = history;
  const preference = window.matchMedia(REDUCED_MOTION_QUERY);
  const observer = new MutationObserver(() => {
    if (!capture.row.isConnected || !viewport.isConnected) {
      capture.cancel();
    }
  });
  let isCancelled = false;
  function cancel() {
    if (isCancelled) {
      return;
    }
    isCancelled = true;
    window.clearTimeout(capture.timeout);
    for (const animation of capture.animations) {
      animation.cancel();
    }
    capture.restoreShape?.();
    observer.disconnect();
    viewport.removeEventListener('wheel', cancel);
    viewport.removeEventListener('touchstart', cancel);
    viewport.removeEventListener('pointerdown', cancel);
    viewport.removeEventListener('keydown', cancel);
    viewport.removeEventListener('scroll', onScroll);
    preference.removeEventListener?.('change', cancel);
    window.removeEventListener('resize', cancel);
    window.removeEventListener('pagehide', cancel);
    if (history.capture === capture) {
      history.capture = undefined;
    }
  }
  function onScroll() {
    if (capture.isPlaying && viewport.scrollTop !== capture.settledScrollTop) {
      cancel();
    }
  }

  capture.cancel = cancel;
  observer.observe(document.body, { childList: true, subtree: true });
  viewport.addEventListener('wheel', cancel, { passive: true });
  viewport.addEventListener('touchstart', cancel, { passive: true });
  viewport.addEventListener('pointerdown', cancel);
  viewport.addEventListener('keydown', cancel);
  viewport.addEventListener('scroll', onScroll, { passive: true });
  preference.addEventListener?.('change', cancel);
  window.addEventListener('resize', cancel);
  window.addEventListener('pagehide', cancel);
  capture.timeout = window.setTimeout(cancel, PENDING_TIMEOUT_MS);
}

function animateNeighbor(options: {
  capture: ReactionLayoutCapture;
  neighbor: RowPosition;
  bubbleRectangle: DOMRect;
}) {
  const { capture, neighbor, bubbleRectangle } = options;
  const { element, rectangle } = neighbor;
  if (!element.isConnected) {
    return;
  }
  const destination = element.getBoundingClientRect();
  capture.settledPositions.set(element, destination);
  const verticalOffset = rectangle.top - destination.top;
  const horizontalOffset = element.contains(capture.bubble)
    ? capture.rectangle.left - bubbleRectangle.left
    : rectangle.left - destination.left;
  if (Math.abs(verticalOffset) > POSITION_TOLERANCE) {
    capture.animations.push(
      element.animate(
        [{ transform: `translateY(${verticalOffset}px)` }, { transform: 'translateY(0px)' }],
        { duration: TRANSITION_DURATION_MS, easing: VERTICAL_EASING, fill: 'both' },
      ),
    );
  }
  if (Math.abs(horizontalOffset) > POSITION_TOLERANCE) {
    capture.animations.push(
      element.animate([{ translate: `${horizontalOffset}px 0px` }, { translate: '0px 0px' }], {
        duration: TRANSITION_DURATION_MS,
        easing: HORIZONTAL_EASING,
        fill: 'both',
      }),
    );
  }
}

function playCapture(history: ReactionLayoutHistory, capture: ReactionLayoutCapture) {
  const destination = capture.bubble.getBoundingClientRect();
  const hasChangedSize =
    Math.abs(destination.height - capture.rectangle.height) > POSITION_TOLERANCE ||
    Math.abs(destination.width - capture.rectangle.width) > POSITION_TOLERANCE;
  const owner = capture.neighbors.find((neighbor) => neighbor.element.contains(capture.bubble));
  const parentOffset = {
    left: owner ? capture.rectangle.left - destination.left : 0,
    top: owner ? owner.rectangle.top - owner.element.getBoundingClientRect().top : 0,
  };
  // Read and position parts before the parent's inversion affects their viewport rectangles.
  capture.settledPositions = animateReactionLayoutParts({
    bubble: capture.bubble,
    previous: capture.parts,
    parentOffset,
    duration: TRANSITION_DURATION_MS,
    horizontalEasing: HORIZONTAL_EASING,
    verticalEasing: VERTICAL_EASING,
    animations: capture.animations,
  });
  for (const neighbor of capture.neighbors) {
    animateNeighbor({ capture, neighbor, bubbleRectangle: destination });
  }
  if (hasChangedSize && destination.width > 0 && destination.height > 0) {
    capture.restoreShape = animateReactionLayoutShape({
      bubble: capture.bubble,
      before: capture.rectangle,
      after: destination,
      duration: TRANSITION_DURATION_MS,
      horizontalEasing: HORIZONTAL_EASING,
      verticalEasing: VERTICAL_EASING,
      animations: capture.animations,
    });
  }
  capture.settledScrollTop = history.viewport.scrollTop;
  capture.isPlaying = true;
  window.clearTimeout(capture.timeout);
  if (capture.animations.length === 0) {
    capture.cancel();
    return;
  }
  capture.timeout = window.setTimeout(capture.cancel, FINISH_TIMEOUT_MS);
  Promise.allSettled(capture.animations.map((animation) => animation.finished)).then(
    capture.cancel,
  );
}

/** Register the history's existing measurement and anchoring owners for local reaction commits. */
export function registerReactionLayoutHistory(options: HistoryRegistration) {
  const previous = histories.get(options.viewport);
  previous?.capture?.cancel();
  const history: ReactionLayoutHistory = { ...options };
  histories.set(options.viewport, history);
  return () => {
    history.capture?.cancel();
    if (histories.get(options.viewport) === history) {
      histories.delete(options.viewport);
    }
  };
}

/** Capture visible geometry immediately before a local reaction changes the committed message. */
export function prepareReactionLayout(options: { row: HTMLElement }) {
  const row = normalizeRow(options.row);
  const history = row ? getHistory(row) : undefined;
  history?.capture?.cancel();
  if (!row || !history || window.matchMedia(REDUCED_MOTION_QUERY).matches) {
    return;
  }
  const bubble = row.querySelector<HTMLElement>('[data-message-content]');
  if (!bubble || typeof bubble.animate !== 'function') {
    return;
  }
  const rectangle = bubble.getBoundingClientRect();
  if (!rectangle.width || !rectangle.height) {
    return;
  }
  const { viewport } = history;
  const distanceFromEnd = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
  const capture: ReactionLayoutCapture = {
    row,
    bubble,
    rectangle,
    neighbors: captureNeighbors(viewport),
    parts: captureReactionLayoutParts(bubble),
    shouldFollowLatest: distanceFromEnd <= BOTTOM_TOLERANCE,
    isQueued: false,
    isPlaying: false,
    settledScrollTop: viewport.scrollTop,
    settledPositions: new Map(),
    animations: [],
    timeout: 0,
    cancel: () => {},
  };
  history.capture = capture;
  watchCapture(history, capture);
}

/** Commit final row measurements once, then animate only the old-to-new presentation geometry. */
export function finishReactionLayout(options: { row: HTMLElement }) {
  const row = normalizeRow(options.row);
  const history = row ? getHistory(row) : undefined;
  const capture = history?.capture;
  if (!row || !history || !capture || capture.row !== row || capture.isQueued) {
    return;
  }
  capture.isQueued = true;
  // Child layout effects run before the virtual row's ref. Leave React's commit first, then flush
  // the one final measurement before paint; no intermediate animation height enters TanStack.
  queueMicrotask(() => {
    if (history.capture !== capture || !row.isConnected) {
      capture.cancel();
      return;
    }
    flushSync(() => history.measureRow(row));
    if (capture.shouldFollowLatest) {
      history.scrollToEnd();
    }
    playCapture(history, capture);
  });
}

/** Read a flight's resting destination without including the row's temporary visual inversion. */
export function readReactionLayoutDestination(options: { element: HTMLElement }): DOMRect {
  const { element } = options;
  const rectangle = element.getBoundingClientRect();
  const content = element.closest<HTMLElement>('[data-message-row-content]');
  const history = getHistory(element);
  const capture = history?.capture;
  const reaction =
    element.closest<HTMLElement>('[data-reaction-position]') ?? element.closest('button');
  const hasReactionPosition = reaction && capture?.settledPositions.has(reaction);
  const owner = hasReactionPosition ? reaction : content;
  const destination = owner ? capture?.settledPositions.get(owner) : undefined;
  if (!owner || !history || !capture?.isPlaying || !destination) {
    return rectangle;
  }
  const current = owner.getBoundingClientRect();
  const scrollChange = history.viewport.scrollTop - capture.settledScrollTop;
  return DOMRect.fromRect({
    x: rectangle.left - current.left + destination.left,
    y: rectangle.top - current.top + destination.top - scrollChange,
    width: rectangle.width,
    height: rectangle.height,
  });
}
