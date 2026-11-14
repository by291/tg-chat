// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  finishReactionLayout,
  prepareReactionLayout,
  readReactionLayoutDestination,
  registerReactionLayoutHistory,
} from './reactionLayoutTransition';

const ORIGINAL_HEIGHT = 60;
const REACTION_HEIGHT = 30;
const NEIGHBOR_TOP = 100;
const VIEWPORT_HEIGHT = 500;

interface AnimatedElement {
  element: Element;
  keyframes: Keyframe[];
  isCancelled: boolean;
}

const animations: AnimatedElement[] = [];
let shouldReduceMotion = false;

beforeEach(() => {
  animations.length = 0;
  shouldReduceMotion = false;
  vi.stubGlobal('matchMedia', () => ({
    matches: shouldReduceMotion,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Element.prototype.animate = function (keyframes) {
    const animation = {
      element: this,
      keyframes: keyframes as Keyframe[],
      isCancelled: false,
    };
    animations.push(animation);

    return {
      cancel: () => {
        animation.isCancelled = true;
      },
      finished: new Promise(() => {}),
    } as unknown as Animation;
  };
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createHistory() {
  const viewport = document.createElement('section');
  viewport.setAttribute('aria-label', 'Message history');
  const row = document.createElement('div');
  row.dataset.messageId = 'message';
  const content = document.createElement('div');
  content.dataset.messageRowContent = '';
  const bubble = document.createElement('div');
  bubble.dataset.messageContent = '';
  bubble.style.background = 'white';
  bubble.style.borderRadius = '15px';
  const neighbor = document.createElement('div');
  neighbor.dataset.messageRowContent = '';
  content.append(bubble);
  row.append(content);
  viewport.append(row, neighbor);
  document.body.append(viewport);
  Object.defineProperty(viewport, 'clientHeight', { value: VIEWPORT_HEIGHT });
  let bubbleHeight = ORIGINAL_HEIGHT;
  let neighborTop = NEIGHBOR_TOP;
  Object.defineProperty(viewport, 'scrollHeight', {
    get: () => VIEWPORT_HEIGHT * 2 + bubbleHeight - ORIGINAL_HEIGHT,
  });

  vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => {
    return DOMRect.fromRect({ width: 400, height: VIEWPORT_HEIGHT });
  });
  vi.spyOn(content, 'getBoundingClientRect').mockImplementation(() => {
    return DOMRect.fromRect({ width: 400, height: bubbleHeight });
  });
  vi.spyOn(bubble, 'getBoundingClientRect').mockImplementation(() => {
    return DOMRect.fromRect({ width: 200, height: bubbleHeight });
  });
  vi.spyOn(neighbor, 'getBoundingClientRect').mockImplementation(() => {
    return DOMRect.fromRect({
      y: neighborTop,
      width: 400,
      height: ORIGINAL_HEIGHT,
    });
  });

  const measureRow = () => {
    neighborTop = NEIGHBOR_TOP + bubbleHeight - ORIGINAL_HEIGHT;
  };
  const scrollToEnd = () => {
    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
  };
  const dispose = registerReactionLayoutHistory({
    viewport,
    measureRow,
    scrollToEnd,
  });

  return {
    viewport,
    row,
    bubble,
    content,
    neighbor,
    measureRow,
    scrollToEnd,
    dispose,
    setHeight: (height: number) => {
      bubbleHeight = height;
    },
  };
}

describe('reaction layout transition', () => {
  it.each([REACTION_HEIGHT, -REACTION_HEIGHT])(
    'keeps neighbors visually anchored across a %s pixel committed height change',
    async (heightChange) => {
      const history = createHistory();
      prepareReactionLayout({ row: history.row });
      history.setHeight(ORIGINAL_HEIGHT + heightChange);
      finishReactionLayout({ row: history.row });
      await Promise.resolve();

      const movement = animations.find((animation) => animation.element === history.neighbor);
      expect(movement?.keyframes).toEqual([
        { transform: `translateY(${-heightChange}px)` },
        { transform: 'translateY(0px)' },
      ]);
      expect(history.neighbor.getBoundingClientRect().top).toBe(NEIGHBOR_TOP + heightChange);
      expect(history.viewport.scrollTop).toBe(0);
      expect(history.neighbor.style.height).toBe('');
      expect(history.bubble.style.height).toBe('');
      history.dispose();
    },
  );

  it('lets the history restore its bottom anchor once before reading final geometry', async () => {
    const history = createHistory();
    history.viewport.scrollTop = VIEWPORT_HEIGHT;
    prepareReactionLayout({ row: history.row });
    history.setHeight(ORIGINAL_HEIGHT + REACTION_HEIGHT);
    finishReactionLayout({ row: history.row });
    await Promise.resolve();

    expect(history.viewport.scrollTop).toBe(VIEWPORT_HEIGHT + REACTION_HEIGHT);
    history.dispose();
  });

  it('restores the shell and cancels movement when the user resumes scrolling', async () => {
    const history = createHistory();
    prepareReactionLayout({ row: history.row });
    history.setHeight(ORIGINAL_HEIGHT + REACTION_HEIGHT);
    finishReactionLayout({ row: history.row });
    await Promise.resolve();
    history.viewport.dispatchEvent(new Event('wheel'));

    expect(history.bubble.style.background).toBe('white');
    expect(history.bubble.querySelector('[data-reaction-layout-shell]')).toBeNull();
    expect(animations.every((animation) => animation.isCancelled)).toBe(true);
    history.dispose();
  });

  it('does not transfer pending motion to a remounted row with the same message ID', async () => {
    const history = createHistory();
    prepareReactionLayout({ row: history.row });
    const replacement = history.row.cloneNode(true) as HTMLElement;
    history.row.replaceWith(replacement);
    finishReactionLayout({ row: replacement });
    await Promise.resolve();

    expect(animations).toHaveLength(0);
    expect(history.neighbor.getBoundingClientRect().top).toBe(NEIGHBOR_TOP);
    history.dispose();
  });

  it('disposes active presentation when the conversation unmounts', async () => {
    const history = createHistory();
    prepareReactionLayout({ row: history.row });
    history.setHeight(ORIGINAL_HEIGHT + REACTION_HEIGHT);
    finishReactionLayout({ row: history.row });
    await Promise.resolve();
    history.dispose();

    expect(history.bubble.style.background).toBe('white');
    expect(animations.every((animation) => animation.isCancelled)).toBe(true);
  });

  it('leaves reduced-motion reaction updates to the normal committed layout', async () => {
    shouldReduceMotion = true;
    const history = createHistory();
    prepareReactionLayout({ row: history.row });
    history.setHeight(ORIGINAL_HEIGHT + REACTION_HEIGHT);
    finishReactionLayout({ row: history.row });
    await Promise.resolve();

    expect(animations).toHaveLength(0);
    expect(history.bubble.style.background).toBe('white');
    history.dispose();
  });

  it('discards a queued capture when a newer gesture owns the scroll position', async () => {
    const history = createHistory();
    prepareReactionLayout({ row: history.row });
    history.setHeight(ORIGINAL_HEIGHT + REACTION_HEIGHT);
    finishReactionLayout({ row: history.row });
    history.viewport.dispatchEvent(new Event('wheel'));
    history.viewport.scrollTop = REACTION_HEIGHT;
    await Promise.resolve();

    expect(animations).toHaveLength(0);
    expect(history.viewport.scrollTop).toBe(REACTION_HEIGHT);
    expect(history.bubble.style.background).toBe('white');
    history.dispose();
  });

  it('replaces an interrupted transition without leaving a stale shell or cleanup', async () => {
    const history = createHistory();
    prepareReactionLayout({ row: history.row });
    history.setHeight(ORIGINAL_HEIGHT + REACTION_HEIGHT);
    finishReactionLayout({ row: history.row });
    await Promise.resolve();
    const previousAnimations = [...animations];
    prepareReactionLayout({ row: history.row });
    history.setHeight(ORIGINAL_HEIGHT);
    finishReactionLayout({ row: history.row });
    finishReactionLayout({ row: history.row });
    await Promise.resolve();

    expect(previousAnimations.every((animation) => animation.isCancelled)).toBe(true);
    expect(history.bubble.querySelectorAll('[data-reaction-layout-shell]')).toHaveLength(1);
    expect(history.bubble.style.backgroundColor).toBe('transparent');
    history.dispose();
    expect(history.bubble.style.background).toBe('white');
  });

  it('returns the final flight destination while the row still displays its old position', async () => {
    const history = createHistory();
    prepareReactionLayout({ row: history.row });
    history.setHeight(ORIGINAL_HEIGHT + REACTION_HEIGHT);
    finishReactionLayout({ row: history.row });
    await Promise.resolve();
    vi.spyOn(history.content, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({
        y: REACTION_HEIGHT,
        width: 400,
        height: ORIGINAL_HEIGHT + REACTION_HEIGHT,
      }),
    );
    vi.spyOn(history.bubble, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({
        y: REACTION_HEIGHT,
        width: 200,
        height: ORIGINAL_HEIGHT + REACTION_HEIGHT,
      }),
    );

    const destination = readReactionLayoutDestination({ element: history.bubble });
    expect(destination.top).toBe(0);
    expect(destination.height).toBe(ORIGINAL_HEIGHT + REACTION_HEIGHT);
    history.dispose();
  });

  it('keeps the flight destination when a new chip cancels its parent row displacement', async () => {
    const history = createHistory();
    vi.spyOn(history.content, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({
        y: REACTION_HEIGHT,
        width: 400,
        height: ORIGINAL_HEIGHT,
      }),
    );
    prepareReactionLayout({ row: history.row });
    const button = document.createElement('button');
    const emoji = document.createElement('span');
    emoji.dataset.reactionEmoji = '❤️';
    button.append(emoji);
    history.bubble.append(button);
    const destination = DOMRect.fromRect({
      y: ORIGINAL_HEIGHT,
      width: 30,
      height: 30,
    });
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(destination);
    vi.spyOn(emoji, 'getBoundingClientRect').mockReturnValue(destination);
    vi.spyOn(history.content, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ width: 400, height: ORIGINAL_HEIGHT + REACTION_HEIGHT }),
    );
    history.setHeight(ORIGINAL_HEIGHT + REACTION_HEIGHT);
    finishReactionLayout({ row: history.row });
    await Promise.resolve();

    // The row remains visually displaced, but the new chip's own motion cancels that displacement.
    vi.spyOn(history.content, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({
        y: REACTION_HEIGHT,
        width: 400,
        height: ORIGINAL_HEIGHT + REACTION_HEIGHT,
      }),
    );
    expect(readReactionLayoutDestination({ element: emoji }).top).toBe(destination.top);
    history.dispose();
  });
});
