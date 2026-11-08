// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animateReactionLayoutParts, captureReactionLayoutParts } from './reactionLayoutParts';

const DURATION_MS = 250;
const HORIZONTAL_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)';
const VERTICAL_EASING = 'cubic-bezier(0.1992, 0.0106, 0.2792, 0.9103)';
const METADATA_RECTANGLE = DOMRect.fromRect({
  x: 130,
  y: 124,
  width: 42,
  height: 12,
});
const CHIP_RECTANGLE = DOMRect.fromRect({
  x: 70,
  y: 100,
  width: 50,
  height: 30,
});

interface RecordedAnimation {
  element: Element;
  frames: Keyframe[];
}

const recordedAnimations: RecordedAnimation[] = [];

beforeEach(() => {
  recordedAnimations.length = 0;
  Element.prototype.animate = function (frames) {
    recordedAnimations.push({ element: this, frames: frames as Keyframe[] });
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

function createBubble() {
  const bubble = document.createElement('div');
  const metadata = document.createElement('span');
  metadata.dataset.messageMetadata = '';
  const timestamp = document.createElement('span');
  timestamp.textContent = '12:30';
  metadata.append(timestamp);
  bubble.append(metadata);
  document.body.append(bubble);
  vi.spyOn(timestamp, 'getBoundingClientRect').mockReturnValue(METADATA_RECTANGLE);
  return { bubble, timestamp };
}

function addReaction(bubble: HTMLElement) {
  const position = document.createElement('span');
  position.dataset.reactionPosition = '';
  const button = document.createElement('button');
  const emoji = document.createElement('span');
  emoji.dataset.reactionEmoji = '❤️';
  button.append(emoji);
  position.append(button);
  bubble.append(position);
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(CHIP_RECTANGLE);
  vi.spyOn(position, 'getBoundingClientRect').mockReturnValue(CHIP_RECTANGLE);
  return { button, position };
}

describe('reaction layout content', () => {
  it.each([
    { left: 40, top: 36 },
    { left: -40, top: -36 },
    { left: 0, top: 36 },
  ])('keeps metadata on its fixed corner during a parent displacement of %j', (parentOffset) => {
    const { bubble, timestamp } = createBubble();
    const previous = captureReactionLayoutParts(bubble);
    animateReactionLayoutParts({
      bubble,
      previous,
      parentOffset,
      duration: DURATION_MS,
      horizontalEasing: HORIZONTAL_EASING,
      verticalEasing: VERTICAL_EASING,
      animations: [],
    });
    const timestampAnimations = recordedAnimations.filter((entry) => entry.element === timestamp);

    expect(timestampAnimations).toContainEqual({
      element: timestamp,
      frames: [{ transform: `translateY(${-parentOffset.top}px)` }, { transform: 'none' }],
    });
    if (parentOffset.left !== 0) {
      expect(timestampAnimations).toContainEqual({
        element: timestamp,
        frames: [{ translate: `${-parentOffset.left}px 0px` }, { translate: '0px 0px' }],
      });
    }
  });

  it('lets a new chip enter at its final position while the bubble grows around it', () => {
    const { bubble } = createBubble();
    const previous = captureReactionLayoutParts(bubble);
    const { button, position } = addReaction(bubble);
    button.style.scale = '0.5';
    const parentOffset = { left: 40, top: 36 };
    animateReactionLayoutParts({
      bubble,
      previous,
      parentOffset,
      duration: DURATION_MS,
      horizontalEasing: HORIZONTAL_EASING,
      verticalEasing: VERTICAL_EASING,
      animations: [],
    });
    const chipAnimations = recordedAnimations.filter((entry) => entry.element === position);

    expect(chipAnimations).toContainEqual({
      element: position,
      frames: [{ translate: '-40px 0px' }, { translate: '0px 0px' }],
    });
    expect(chipAnimations).toContainEqual({
      element: position,
      frames: [{ transform: 'translateY(-36px)' }, { transform: 'none' }],
    });
    expect(recordedAnimations.filter((entry) => entry.element === button)).toEqual([]);
    expect(button.style.scale).toBe('0.5');
  });

  it('moves an existing chip from its previous position without scaling its content', () => {
    const { bubble } = createBubble();
    const { position } = addReaction(bubble);
    const previous = captureReactionLayoutParts(bubble);
    vi.spyOn(position, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({
        x: 100,
        y: 136,
        width: 50,
        height: 30,
      }),
    );
    animateReactionLayoutParts({
      bubble,
      previous,
      parentOffset: { left: 0, top: 0 },
      duration: DURATION_MS,
      horizontalEasing: HORIZONTAL_EASING,
      verticalEasing: VERTICAL_EASING,
      animations: [],
    });
    const chipAnimations = recordedAnimations.filter((entry) => entry.element === position);

    expect(chipAnimations).toContainEqual({
      element: position,
      frames: [{ translate: '-30px 0px' }, { translate: '0px 0px' }],
    });
    expect(chipAnimations).toContainEqual({
      element: position,
      frames: [{ transform: 'translateY(-36px)' }, { transform: 'none' }],
    });
  });
});
