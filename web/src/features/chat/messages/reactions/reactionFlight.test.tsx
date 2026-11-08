// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { dropReactionFlights, holdReactionFlight, launchReactionFlight } from './reactionFlight';
import { MessageReaction } from './MessageReaction';
import { CUSTOM_EMOJI } from '@/features/emoji/customEmojiCatalog';
import { getCustomReactionKey } from './reactionEmoji';

const MESSAGE_ID = 'reaction-message';
const EMOJI = '❤️';
const FRAME_DURATION_MS = 16;
const EXPIRED_HOLD_MS = 1000;
const SCROLL_DISTANCE_PX = 40;
const SOURCE_HOVER_SCALE = 1.2;
const SOURCE_RECTANGLE = {
  x: 100,
  y: 200,
  width: 32,
  height: 32,
};
const TARGET_RECTANGLE = {
  x: 240,
  y: 300,
  width: 22,
  height: 22,
};
const VIEWPORT_RECTANGLE = {
  x: 0,
  y: 0,
  width: 800,
  height: 600,
};

interface RecordedAnimation {
  element: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  finish: () => void;
  cancel: () => void;
}

let animations: RecordedAnimation[];

function createScene() {
  const history = document.createElement('section');
  history.setAttribute('aria-label', 'Message history');
  const targetRow = document.createElement('article');
  const source = document.createElement('span');
  source.textContent = EMOJI;
  source.dataset.reactionEmoji = EMOJI;
  history.append(targetRow);
  document.body.append(history, source);
  source.getBoundingClientRect = () => DOMRect.fromRect(SOURCE_RECTANGLE);
  history.getBoundingClientRect = () => DOMRect.fromRect(VIEWPORT_RECTANGLE);

  function addReaction(options?: { rectangle: DOMRectInit }) {
    const button = document.createElement('button');
    const target = document.createElement('span');
    target.dataset.reactionEmoji = EMOJI;
    target.textContent = EMOJI;
    target.getBoundingClientRect = () => DOMRect.fromRect(options?.rectangle ?? TARGET_RECTANGLE);
    button.append(target);
    targetRow.append(button);
    launchReactionFlight({ target, emoji: EMOJI, messageId: MESSAGE_ID });
    return target;
  }

  return {
    history,
    targetRow,
    source,
    addReaction,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  animations = [];
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    return window.setTimeout(() => callback(performance.now()), FRAME_DURATION_MS);
  });
  vi.stubGlobal('cancelAnimationFrame', window.clearTimeout);
  Element.prototype.animate = vi.fn(function (this: Element, keyframes, options) {
    let finish = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const cancel = vi.fn(finish);
    animations.push({
      element: this,
      keyframes,
      options,
      finish,
      cancel,
    } as RecordedAnimation);
    return { finished, cancel } as unknown as Animation;
  });
});

afterEach(() => {
  cleanup();
  dropReactionFlights();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('reaction flight ownership', () => {
  it('keeps a custom preview visible after the picker artwork is removed', async () => {
    const scene = createScene();
    const custom = CUSTOM_EMOJI[0];
    const emoji = getCustomReactionKey(custom.id);
    scene.source.dataset.reactionEmoji = emoji;
    const preview = document.createElement('img');
    preview.src = custom.preview;
    scene.source.replaceChildren(preview);
    holdReactionFlight({ ...scene, emoji, messageId: MESSAGE_ID });

    const flight = document.querySelector<HTMLElement>('[data-reaction-flight]')!;
    const capturedPreview = flight.querySelector('img')!;
    expect(capturedPreview).not.toBeNull();
    expect(capturedPreview).not.toBe(preview);
    expect(capturedPreview.src).toBe(preview.src);
    scene.source.remove();
    await Promise.resolve();

    expect(capturedPreview.isConnected).toBe(true);
    expect(flight.textContent).not.toContain(emoji);
    expect(flight.textContent).not.toContain(custom.emoji);
  });

  it('uses the bundled preview when a custom canvas cannot be captured', () => {
    const scene = createScene();
    const custom = CUSTOM_EMOJI[0];
    const emoji = getCustomReactionKey(custom.id);
    const canvas = document.createElement('canvas');
    scene.source.replaceChildren(canvas);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    holdReactionFlight({ ...scene, emoji, messageId: MESSAGE_ID });

    const flight = document.querySelector<HTMLElement>('[data-reaction-flight]')!;
    expect(flight.querySelector('img')?.getAttribute('src')).toBe(custom.preview);
    expect(flight.textContent).not.toContain(emoji);
  });

  it('captures a hovered emoji at its rendered size instead of its unscaled font size', () => {
    const scene = createScene();
    scene.source.style.fontSize = `${SOURCE_RECTANGLE.height}px`;
    scene.source.style.lineHeight = `${SOURCE_RECTANGLE.height}px`;
    Object.defineProperty(scene.source, 'offsetHeight', { value: SOURCE_RECTANGLE.height });
    const hoveredRectangle = {
      ...SOURCE_RECTANGLE,
      width: SOURCE_RECTANGLE.width * SOURCE_HOVER_SCALE,
      height: SOURCE_RECTANGLE.height * SOURCE_HOVER_SCALE,
    };
    scene.source.getBoundingClientRect = () => DOMRect.fromRect(hoveredRectangle);
    holdReactionFlight({ ...scene, emoji: EMOJI, messageId: MESSAGE_ID });

    const flight = document.querySelector<HTMLElement>('[data-reaction-flight]')!;
    const picture = flight.firstElementChild as HTMLElement;
    const capturedFontSize = Number.parseFloat(picture.style.fontSize);
    const capturedLineHeight = Number.parseFloat(picture.style.lineHeight);
    expect(capturedFontSize / SOURCE_RECTANGLE.height).toBeCloseTo(SOURCE_HOVER_SCALE);
    expect(capturedLineHeight).toBeCloseTo(hoveredRectangle.height);
    expect(Number.parseFloat(flight.style.height)).toBeCloseTo(capturedLineHeight);
  });

  it('holds the chosen emoji until its message renders and reveals it after landing', async () => {
    const scene = createScene();
    holdReactionFlight({ ...scene, emoji: EMOJI, messageId: MESSAGE_ID });
    expect(scene.source.style.visibility).toBe('hidden');
    expect(document.querySelector('[data-reaction-flight]')).not.toBeNull();

    const target = scene.addReaction();
    expect(target.style.visibility).toBe('hidden');
    vi.advanceTimersByTime(FRAME_DURATION_MS);
    for (const animation of animations) {
      animation.finish();
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(target.style.visibility).toBe('');
    expect(scene.source.style.visibility).toBe('');
    expect(document.querySelector('[data-reaction-flight]')).toBeNull();
  });

  it('follows history scrolling and restores visibility when the target disappears', async () => {
    const scene = createScene();
    holdReactionFlight({ ...scene, emoji: EMOJI, messageId: MESSAGE_ID });
    const target = scene.addReaction();
    vi.advanceTimersByTime(FRAME_DURATION_MS);
    scene.history.scrollTop = SCROLL_DISTANCE_PX;
    scene.history.dispatchEvent(new Event('scroll'));

    const flight = document.querySelector<HTMLElement>('[data-reaction-flight]')!;
    expect(flight.style.translate).toBe('0px -40px');
    target.remove();
    await Promise.resolve();

    expect(target.style.visibility).toBe('');
    expect(scene.source.style.visibility).toBe('');
    expect(flight.isConnected).toBe(false);
  });

  it('expires an unconsumed selection and never animates restored history', () => {
    const scene = createScene();
    holdReactionFlight({ ...scene, emoji: EMOJI, messageId: MESSAGE_ID });
    vi.advanceTimersByTime(EXPIRED_HOLD_MS);
    const target = scene.addReaction();

    expect(target.style.visibility).toBe('');
    expect(scene.source.style.visibility).toBe('');
    expect(animations).toHaveLength(0);
    expect(document.querySelector('[data-reaction-flight]')).toBeNull();
  });

  it('ignores another rendering of the message until its owning row mounts the reaction', () => {
    const scene = createScene();
    holdReactionFlight({ ...scene, emoji: EMOJI, messageId: MESSAGE_ID });
    const preview = document.createElement('span');
    document.body.append(preview);
    launchReactionFlight({ target: preview, emoji: EMOJI, messageId: MESSAGE_ID });
    expect(preview.style.visibility).toBe('');
    expect(animations).toHaveLength(0);

    const target = scene.addReaction();
    expect(target.style.visibility).toBe('hidden');
    expect(document.querySelectorAll('[data-reaction-flight]')).toHaveLength(1);
  });

  it('skips reduced motion and already selected reactions', () => {
    const scene = createScene();
    scene.addReaction();
    holdReactionFlight({ ...scene, emoji: EMOJI, messageId: MESSAGE_ID });
    expect(document.querySelector('[data-reaction-flight]')).toBeNull();

    scene.targetRow.replaceChildren();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    holdReactionFlight({ ...scene, emoji: EMOJI, messageId: MESSAGE_ID });
    expect(document.querySelector('[data-reaction-flight]')).toBeNull();
    expect(scene.source.style.visibility).toBe('');
  });

  it('keeps a new selection intact when the interrupted flight finishes', async () => {
    const scene = createScene();
    holdReactionFlight({ ...scene, emoji: EMOJI, messageId: MESSAGE_ID });
    const previousTarget = scene.addReaction();
    vi.advanceTimersByTime(FRAME_DURATION_MS);
    const previousAnimations = [...animations];
    dropReactionFlights(scene.targetRow);
    previousTarget.remove();
    holdReactionFlight({ ...scene, emoji: EMOJI, messageId: MESSAGE_ID });
    const currentTarget = scene.addReaction();
    for (const animation of previousAnimations) {
      animation.finish();
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(currentTarget.style.visibility).toBe('hidden');
    expect(document.querySelectorAll('[data-reaction-flight]')).toHaveLength(1);
    dropReactionFlights(scene.targetRow);
    expect(currentTarget.style.visibility).toBe('');
  });

  it('survives Strict Mode replay without animating historical remounts', async () => {
    const scene = createScene();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => {
      return DOMRect.fromRect(TARGET_RECTANGLE);
    });
    holdReactionFlight({ ...scene, emoji: EMOJI, messageId: MESSAGE_ID });
    const reaction = (
      <StrictMode>
        <MessageReaction emoji={EMOJI} messageId={MESSAGE_ID} onReact={() => {}} />
      </StrictMode>
    );
    const view = render(reaction, { container: scene.targetRow });
    const target = scene.targetRow.querySelector<HTMLElement>('[data-reaction-emoji]')!;
    expect(target.style.visibility).toBe('hidden');

    view.unmount();
    await Promise.resolve();
    expect(document.querySelector('[data-reaction-flight]')).toBeNull();

    const restoredRow = document.createElement('article');
    scene.history.append(restoredRow);
    render(reaction, { container: restoredRow });
    const restoredTarget = restoredRow.querySelector<HTMLElement>('[data-reaction-emoji]')!;
    expect(restoredTarget.style.visibility).toBe('');
    expect(document.querySelector('[data-reaction-flight]')).toBeNull();
  });

  it('follows a rising arc and lands at the target position and size', () => {
    const scene = createScene();
    holdReactionFlight({ ...scene, emoji: EMOJI, messageId: MESSAGE_ID });
    scene.addReaction();
    vi.advanceTimersByTime(FRAME_DURATION_MS);

    const keyframes = animations[0].keyframes;
    const halfway = keyframes.find((keyframe) => keyframe.offset === 0.5)!;
    const coordinates = String(halfway.transform)
      .match(/-?\d+(?:\.\d+)?/g)!
      .map(Number);
    const [translateX, translateY, , scaleY] = coordinates;
    const halfwayMiddle = SOURCE_RECTANGLE.y + translateY + (SOURCE_RECTANGLE.height * scaleY) / 2;
    const sourceMiddle = SOURCE_RECTANGLE.y + SOURCE_RECTANGLE.height / 2;
    expect(translateX).toBe((TARGET_RECTANGLE.x - SOURCE_RECTANGLE.x) / 2);
    expect(halfwayMiddle).toBeLessThan(sourceMiddle);

    const finalKeyframe = keyframes.at(-1)!;
    const finalCoordinates = String(finalKeyframe.transform)
      .match(/-?\d+(?:\.\d+)?/g)!
      .map(Number);
    const [endX, endY, endScaleX, endScaleY] = finalCoordinates;
    expect(SOURCE_RECTANGLE.x + endX).toBe(TARGET_RECTANGLE.x);
    expect(SOURCE_RECTANGLE.y + endY).toBe(TARGET_RECTANGLE.y);
    expect(SOURCE_RECTANGLE.width * endScaleX).toBe(TARGET_RECTANGLE.width);
    expect(SOURCE_RECTANGLE.height * endScaleY).toBe(TARGET_RECTANGLE.height);
  });

  it('uses the settled destination after history anchoring before the first flight frame', () => {
    const scene = createScene();
    holdReactionFlight({ ...scene, emoji: EMOJI, messageId: MESSAGE_ID });
    const target = scene.addReaction({
      rectangle: {
        ...TARGET_RECTANGLE,
        y: VIEWPORT_RECTANGLE.height + SCROLL_DISTANCE_PX,
      },
    });
    const settledRectangle = {
      ...TARGET_RECTANGLE,
      y: TARGET_RECTANGLE.y - SCROLL_DISTANCE_PX,
    };
    target.getBoundingClientRect = () => DOMRect.fromRect(settledRectangle);
    scene.history.scrollTop = SCROLL_DISTANCE_PX;
    scene.history.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(FRAME_DURATION_MS);

    const finalKeyframe = animations[0].keyframes.at(-1)!;
    const finalCoordinates = String(finalKeyframe.transform)
      .match(/-?\d+(?:\.\d+)?/g)!
      .map(Number);
    const flight = document.querySelector<HTMLElement>('[data-reaction-flight]')!;
    expect(SOURCE_RECTANGLE.y + finalCoordinates[1]).toBe(settledRectangle.y);
    expect(flight.style.translate).toBe('');

    scene.history.scrollTop += SCROLL_DISTANCE_PX;
    scene.history.dispatchEvent(new Event('scroll'));
    expect(flight.style.translate).toBe(`0px ${-SCROLL_DISTANCE_PX}px`);
  });

  it('grows and reveals a newly selected chip without changing its layout dimensions', async () => {
    const scene = createScene();
    holdReactionFlight({ ...scene, emoji: EMOJI, messageId: MESSAGE_ID });
    const target = scene.addReaction();
    const button = target.parentElement!;
    vi.advanceTimersByTime(FRAME_DURATION_MS);

    const chipAnimations = animations.filter((animation) => animation.element === button);
    const growing = chipAnimations.find((animation) => animation.keyframes[0].scale);
    const appearing = chipAnimations.find((animation) => animation.keyframes[0].opacity === 0);
    expect(Number(growing?.keyframes[0].scale)).toBeLessThan(1);
    expect(Number(growing?.keyframes.at(-1)?.scale)).toBe(1);
    expect(appearing?.keyframes.at(-1)?.opacity).toBe(1);
    expect(button.style.height).toBe('');
    expect(button.style.width).toBe('');

    dropReactionFlights(scene.targetRow);
    await Promise.resolve();
    expect(target.style.visibility).toBe('');
    for (const animation of chipAnimations) {
      expect(animation.cancel).toHaveBeenCalled();
    }
  });
});
