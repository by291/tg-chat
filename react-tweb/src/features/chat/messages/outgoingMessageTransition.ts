import { cubicBezier } from 'motion';
import styles from './outgoingMessageTransition.module.css';

const FLIGHT_DURATION_MS = 300;
const SOURCE_FADE_MS = 100;
const BUBBLE_FADE_MS = 80;
const BACKGROUND_FADE_MS = 100;
const METADATA_FADE_MS = 250;
const LANDING_TIMEOUT_MS = 600;
const POSITION_TOLERANCE = 1;
// prettier-ignore
const HORIZONTAL_CURVE = [
  0.23,
  1,
  0.32,
  1,
] as const;
// prettier-ignore
const VERTICAL_CURVE = [
  0.1992,
  0.0106,
  0.2792,
  0.9103,
] as const;
const easeHorizontal = cubicBezier(...HORIZONTAL_CURVE);
const easeVertical = cubicBezier(...VERTICAL_CURVE);
const TEXT_STYLE_PROPERTIES = [
  'font',
  'line-height',
  'color',
  'letter-spacing',
  'text-align',
  'direction',
  'white-space',
  'word-break',
  'overflow-wrap',
  'padding',
];

interface Rectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OutgoingMessageOrigin {
  field: Rectangle;
  editor: Rectangle;
  content: HTMLElement;
  textStart: { left: number; top: number };
}

export interface OutgoingMessageMount {
  messageId: string;
  element: HTMLElement;
}

interface FlightOptions {
  origin: OutgoingMessageOrigin;
  element: HTMLElement;
  container: HTMLElement;
  onFinish: () => void;
}

function readRectangle(element: HTMLElement): Rectangle {
  const rectangle = element.getBoundingClientRect();
  return {
    left: rectangle.left,
    top: rectangle.top,
    width: rectangle.width,
    height: rectangle.height,
  };
}

function readTextStart(element: HTMLElement) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    const start = text.search(/\S/);
    if (start < 0 || node.parentElement?.closest('[data-message-metadata]')) {
      continue;
    }
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 1);
    const rectangle = range.getBoundingClientRect();
    return { left: rectangle.left, top: rectangle.top };
  }
  const rectangle = element.getBoundingClientRect();
  return { left: rectangle.left, top: rectangle.top };
}

function removeCloneIdentity(element: HTMLElement) {
  element.removeAttribute('id');
  element.removeAttribute('contenteditable');
  for (const child of element.querySelectorAll('[id], [contenteditable]')) {
    child.removeAttribute('id');
    child.removeAttribute('contenteditable');
  }
}

/** Capture the draft before React clears it; animation snapshots never enter persisted messages. */
export function captureOutgoingMessage(options: {
  field: HTMLElement;
  editor: HTMLElement;
}): OutgoingMessageOrigin | undefined {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return undefined;
  }
  const { field, editor } = options;
  const content = editor.cloneNode(true) as HTMLElement;
  removeCloneIdentity(content);
  const computedStyle = getComputedStyle(editor);
  for (const property of TEXT_STYLE_PROPERTIES) {
    content.style.setProperty(property, computedStyle.getPropertyValue(property));
  }
  content.style.width = `${editor.clientWidth}px`;
  content.style.height = 'auto';
  content.style.minHeight = '0';
  content.style.maxHeight = 'none';
  content.style.overflow = 'visible';
  content.style.margin = '0';
  content.style.transform = `translateY(${-editor.scrollTop}px)`;
  return {
    field: readRectangle(field),
    editor: readRectangle(editor),
    content,
    textStart: readTextStart(editor),
  };
}

function createLayer(className: string) {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

function readDestination(element: HTMLElement) {
  const rectangle = readRectangle(element);
  const history = element.closest<HTMLElement>('[aria-label="Message history"]');
  const rows = history?.querySelector<HTMLElement>('[data-history-rows]');
  const rowsTransform = rows ? getComputedStyle(rows).transform : 'none';
  const revealOffset = rowsTransform === 'none' ? 0 : new DOMMatrixReadOnly(rowsTransform).m42;
  const scrollDistance = history
    ? Math.max(0, history.scrollHeight - history.clientHeight - history.scrollTop)
    : 0;
  return {
    ...rectangle,
    top: rectangle.top - scrollDistance - revealOffset,
  };
}

function advanceRectangle(options: {
  current: Rectangle;
  destination: Rectangle;
  horizontalStep: number;
  verticalStep: number;
}): Rectangle {
  const { current, destination, horizontalStep, verticalStep } = options;
  return {
    left: current.left + (destination.left - current.left) * horizontalStep,
    top: current.top + (destination.top - current.top) * verticalStep,
    width: current.width + (destination.width - current.width) * horizontalStep,
    height: current.height + (destination.height - current.height) * verticalStep,
  };
}

function positionLayer(options: {
  element: HTMLElement;
  rectangle: Rectangle;
  container: Rectangle;
}) {
  const { element, rectangle, container } = options;
  element.style.left = `${rectangle.left - container.left}px`;
  element.style.top = `${rectangle.top - container.top}px`;
  element.style.width = `${rectangle.width}px`;
  element.style.height = `${rectangle.height}px`;
}

function startFlight({ origin, element, container, onFinish }: FlightOptions): () => void {
  const target = element.querySelector<HTMLElement>('[data-message-content]');
  if (!target) {
    onFinish();
    return () => {};
  }
  const bubble = target;
  const history = element.closest<HTMLElement>('[aria-label="Message history"]');
  const root = createLayer(styles.flight);
  root.setAttribute('aria-hidden', 'true');
  root.inert = true;
  const background = createLayer(styles.background);
  const clip = createLayer(styles.clip);
  const source = createLayer(styles.content);
  const destination = createLayer(styles.content);
  const shell = element.cloneNode(false) as HTMLElement;
  removeCloneIdentity(shell);
  const bubbleCopy = bubble.cloneNode(true) as HTMLElement;
  removeCloneIdentity(bubbleCopy);
  bubbleCopy.style.background = 'transparent';
  bubbleCopy.style.boxShadow = 'none';
  bubbleCopy.style.maxWidth = 'none';
  bubbleCopy.style.width = '100%';
  const tail = bubbleCopy.querySelector<HTMLElement>('[data-message-tail]');
  if (tail) {
    tail.style.visibility = 'hidden';
  }
  shell.style.display = 'block';
  shell.style.padding = '0';
  shell.append(bubbleCopy);
  destination.append(shell);
  source.append(origin.content);
  clip.append(source, destination);
  root.append(background, clip);
  container.append(root);

  const bubbleStyle = getComputedStyle(bubble);
  background.style.background = bubbleStyle.background;
  background.style.borderRadius = bubbleStyle.borderRadius;
  background.style.boxShadow = bubbleStyle.boxShadow;
  const initialDestination = readDestination(bubble);
  let current = { ...origin.field };
  let currentContent = {
    ...origin.editor,
    left: origin.textStart.left,
    top: origin.textStart.top,
  };
  let startedAt: number | undefined;
  let previousHorizontal = 0;
  let previousVertical = 0;
  let frame = 0;
  let isFinished = false;
  const originalOpacity = bubble.style.opacity;
  const metadata = bubbleCopy.querySelector<HTMLElement>('[data-message-metadata]');
  const originalTail = bubble.querySelector<SVGElement>('[data-message-tail]');
  const tailCopy = originalTail?.cloneNode(true) as SVGElement | undefined;
  if (tailCopy && originalTail) {
    tailCopy.setAttribute('class', styles.tail);
    tailCopy.style.fill = bubbleStyle.backgroundColor;
    tailCopy.style.transform = getComputedStyle(originalTail).transform;
    root.append(tailCopy);
  }
  // Opacity also hides timestamp descendants that explicitly override visibility. Exchange the
  // overlay and real bubble in one frame so neither a duplicate nor a blank frame is painted.
  bubble.style.opacity = '0';

  function finish() {
    if (isFinished) {
      return;
    }
    isFinished = true;
    cancelAnimationFrame(frame);
    bubble.style.opacity = originalOpacity;
    root.remove();
    history?.removeEventListener('wheel', finish);
    history?.removeEventListener('touchstart', finish);
    history?.removeEventListener('pointerdown', finish);
    history?.removeEventListener('keydown', finish);
    onFinish();
  }

  function draw(timestamp: number) {
    if (!bubble.isConnected || !container.isConnected) {
      finish();
      return;
    }
    startedAt ??= timestamp;
    const elapsed = timestamp - startedAt;
    const progress = Math.min(1, elapsed / FLIGHT_DURATION_MS);
    const horizontal = easeHorizontal(progress);
    const vertical = easeVertical(progress);
    const horizontalStep =
      previousHorizontal === 1 ? 1 : (horizontal - previousHorizontal) / (1 - previousHorizontal);
    const verticalStep =
      previousVertical === 1 ? 1 : (vertical - previousVertical) / (1 - previousVertical);
    const landing = readDestination(bubble);
    const containerRectangle = readRectangle(container);
    const text = bubble.querySelector<HTMLElement>('[data-message-text]') ?? bubble;
    const textStart = readTextStart(text);
    const bubbleRectangle = bubble.getBoundingClientRect();
    const textOffsetLeft = textStart.left - bubbleRectangle.left;
    const textOffsetTop = textStart.top - bubbleRectangle.top;
    current = advanceRectangle({
      current,
      destination: landing,
      horizontalStep,
      verticalStep,
    });
    currentContent = advanceRectangle({
      current: currentContent,
      destination: {
        left: landing.left + textOffsetLeft,
        top: landing.top + textOffsetTop,
        width: origin.editor.width,
        height: origin.editor.height,
      },
      horizontalStep,
      verticalStep,
    });
    positionLayer({ element: root, rectangle: current, container: containerRectangle });
    const sourceLeft =
      currentContent.left - current.left + origin.editor.left - origin.textStart.left;
    const sourceTop = currentContent.top - current.top + origin.editor.top - origin.textStart.top;
    source.style.left = `${sourceLeft}px`;
    source.style.top = `${sourceTop}px`;
    source.style.opacity = String(Math.max(0, 1 - elapsed / SOURCE_FADE_MS));
    destination.style.left = `${currentContent.left - current.left - textOffsetLeft}px`;
    destination.style.top = `${currentContent.top - current.top - textOffsetTop}px`;
    destination.style.width = `${landing.width}px`;
    destination.style.opacity = String(Math.min(1, elapsed / BUBBLE_FADE_MS));
    background.style.opacity = String(Math.min(1, elapsed / BACKGROUND_FADE_MS));
    if (tailCopy) {
      tailCopy.style.opacity = background.style.opacity;
      tailCopy.style.visibility = bubble.querySelector('[data-message-tail]') ? '' : 'hidden';
    }
    background.style.borderRadius = getComputedStyle(bubble).borderRadius;
    if (metadata) {
      metadata.style.opacity = String(Math.min(1, elapsed / METADATA_FADE_MS));
    }
    previousHorizontal = horizontal;
    previousVertical = vertical;

    const hasLanded =
      Math.abs(bubble.getBoundingClientRect().top - landing.top) < POSITION_TOLERANCE;
    const hasChangedWidth = Math.abs(landing.width - initialDestination.width) > POSITION_TOLERANCE;
    if ((progress === 1 && hasLanded) || hasChangedWidth || elapsed >= LANDING_TIMEOUT_MS) {
      finish();
      return;
    }
    frame = requestAnimationFrame(draw);
  }

  // The first frame uses the captured input geometry, before scrolling and editor collapse settle.
  positionLayer({ element: root, rectangle: current, container: readRectangle(container) });
  source.style.left = `${origin.editor.left - origin.field.left}px`;
  source.style.top = `${origin.editor.top - origin.field.top}px`;
  destination.style.opacity = '0';
  background.style.opacity = '0';
  if (tailCopy) {
    tailCopy.style.opacity = '0';
  }
  history?.addEventListener('wheel', finish, { passive: true });
  history?.addEventListener('touchstart', finish, { passive: true });
  history?.addEventListener('pointerdown', finish);
  history?.addEventListener('keydown', finish);
  frame = requestAnimationFrame(draw);
  return finish;
}

/** Match captured drafts to committed message IDs and clean up flights when their chat unmounts. */
export function createOutgoingMessageTransitions(options: {
  getContainer: () => HTMLElement | null;
}) {
  const origins = new Map<string, OutgoingMessageOrigin>();
  const flights = new Map<string, () => void>();

  function prepare(options: { messageId: string; origin: OutgoingMessageOrigin }) {
    origins.set(options.messageId, options.origin);
  }

  function mount({ messageId, element }: OutgoingMessageMount) {
    const origin = origins.get(messageId);
    const container = options.getContainer();
    if (!origin || !container) {
      return;
    }
    origins.delete(messageId);
    const cancel = startFlight({
      origin,
      element,
      container,
      onFinish: () => flights.delete(messageId),
    });
    flights.set(messageId, cancel);
    return cancel;
  }

  function dispose() {
    for (const cancel of flights.values()) {
      cancel();
    }
    flights.clear();
    origins.clear();
  }

  return {
    prepare,
    mount,
    dispose,
  };
}
