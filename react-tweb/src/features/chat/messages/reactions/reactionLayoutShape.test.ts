// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animateReactionLayoutShape } from './reactionLayoutShape';

const DURATION_MS = 250;
const HORIZONTAL_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)';
const VERTICAL_EASING = 'cubic-bezier(0.1992, 0.0106, 0.2792, 0.9103)';
const SMALL_BUBBLE = { width: 80, height: 40 };
const LARGE_BUBBLE = { width: 150, height: 76 };

interface RecordedAnimation {
  element: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
}

const recordedAnimations: RecordedAnimation[] = [];

beforeEach(() => {
  recordedAnimations.length = 0;
  Element.prototype.animate = function (frames, options) {
    recordedAnimations.push({
      element: this,
      frames: frames as Keyframe[],
      options: options as KeyframeAnimationOptions,
    });
    return {
      cancel: () => {},
      finished: new Promise(() => {}),
    } as unknown as Animation;
  };
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function createBubble({ isOwn }: { isOwn: boolean }) {
  const row = document.createElement('article');
  row.dataset.own = String(isOwn);
  const bubble = document.createElement('div');
  bubble.style.background = 'white';
  bubble.style.borderRadius = '15px';
  bubble.style.isolation = 'isolate';
  const tail = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tail.dataset.messageTail = '';
  tail.style.transform = isOwn ? 'translateY(1px) scaleX(-1)' : 'translateY(1px)';
  bubble.append(tail);
  row.append(bubble);
  document.body.append(row);
  return { bubble, tail };
}

describe('reaction bubble shape', () => {
  it('replaces the real shadow immediately and restores its original transition after morphing', () => {
    const { bubble } = createBubble({ isOwn: false });
    const originalShadow = 'rgb(16, 35, 47) 0px 1px 2px';
    const originalTransition = 'box-shadow, transform';
    bubble.style.boxShadow = originalShadow;
    bubble.style.transitionProperty = originalTransition;
    const cleanup = animateReactionLayoutShape({
      bubble,
      before: SMALL_BUBBLE,
      after: LARGE_BUBBLE,
      duration: DURATION_MS,
      horizontalEasing: HORIZONTAL_EASING,
      verticalEasing: VERTICAL_EASING,
      animations: [],
    });

    expect(getComputedStyle(bubble).boxShadow).toBe('none');
    expect(getComputedStyle(bubble).transitionProperty).toBe('none');
    cleanup();
    expect(getComputedStyle(bubble).boxShadow).toBe(originalShadow);
    expect(getComputedStyle(bubble).transitionProperty).toBe(originalTransition);
  });

  it.each([
    { isOwn: true, before: SMALL_BUBBLE, after: LARGE_BUBBLE },
    { isOwn: true, before: LARGE_BUBBLE, after: SMALL_BUBBLE },
    { isOwn: false, before: SMALL_BUBBLE, after: LARGE_BUBBLE },
    { isOwn: false, before: LARGE_BUBBLE, after: SMALL_BUBBLE },
  ])('keeps the tail on its bubble edge as dimensions change: %j', (scenario) => {
    const { bubble, tail } = createBubble({ isOwn: scenario.isOwn });
    const originalTransform = tail.style.transform;
    const cleanup = animateReactionLayoutShape({
      bubble,
      before: scenario.before,
      after: scenario.after,
      duration: DURATION_MS,
      horizontalEasing: HORIZONTAL_EASING,
      verticalEasing: VERTICAL_EASING,
      animations: [],
    });
    const tailAnimations = recordedAnimations.filter((animation) => animation.element === tail);
    const horizontal = tailAnimations.find(
      (animation) => animation.options.easing === HORIZONTAL_EASING,
    );
    const vertical = tailAnimations.find(
      (animation) => animation.options.easing === VERTICAL_EASING,
    );
    const widthChange = scenario.before.width - scenario.after.width;
    const heightChange = scenario.before.height - scenario.after.height;

    if (scenario.isOwn) {
      expect(horizontal?.frames).toEqual([
        { translate: `${widthChange}px 0px` },
        { translate: '0px 0px' },
      ]);
    } else {
      expect(horizontal).toBeUndefined();
    }
    expect(vertical?.frames).toEqual([
      { transform: `translateY(${heightChange}px) ${originalTransform}` },
      { transform: originalTransform },
    ]);
    cleanup();
    expect(tail.style.transform).toBe(originalTransform);
    expect(bubble.style.background).toBe('white');
  });
});
