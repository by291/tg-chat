const POSITION_TOLERANCE = 0.5;

export interface ReactionLayoutParts {
  metadata?: DOMRect;
  reactions: Map<string, DOMRect>;
}

interface PartAnimationOptions {
  bubble: HTMLElement;
  previous: ReactionLayoutParts;
  parentOffset: { left: number; top: number };
  duration: number;
  horizontalEasing: string;
  verticalEasing: string;
  animations: Animation[];
}

function getMetadata(bubble: HTMLElement) {
  const metadata = bubble.querySelector('[data-message-metadata]')?.lastElementChild;
  return metadata instanceof HTMLElement ? metadata : undefined;
}

function getReactions(bubble: HTMLElement) {
  const reactions = new Map<string, HTMLElement>();
  for (const emoji of bubble.querySelectorAll<HTMLElement>('[data-reaction-emoji]')) {
    const position =
      emoji.closest<HTMLElement>('[data-reaction-position]') ?? emoji.closest('button');
    if (position && emoji.dataset.reactionEmoji) {
      reactions.set(emoji.dataset.reactionEmoji, position);
    }
  }
  return reactions;
}

function animatePart(options: {
  element: HTMLElement;
  before?: DOMRect;
  after: DOMRect;
  isMetadata: boolean;
  animation: PartAnimationOptions;
}) {
  const { element, after, isMetadata, animation } = options;
  // Newly added reactions enter at their destination, without inheriting the old row position.
  const before = options.before ?? after;
  const horizontalDelta = isMetadata ? before.right - after.right : before.left - after.left;
  const verticalDelta = isMetadata ? before.bottom - after.bottom : before.top - after.top;
  const horizontalOffset = horizontalDelta - animation.parentOffset.left;
  const verticalOffset = verticalDelta - animation.parentOffset.top;
  if (Math.abs(horizontalOffset) > POSITION_TOLERANCE) {
    animation.animations.push(
      element.animate([{ translate: `${horizontalOffset}px 0px` }, { translate: '0px 0px' }], {
        duration: animation.duration,
        easing: animation.horizontalEasing,
        fill: 'both',
      }),
    );
  }
  if (Math.abs(verticalOffset) > POSITION_TOLERANCE) {
    const originalTransform = getComputedStyle(element).transform || 'none';
    const baseTransform = originalTransform === 'none' ? '' : originalTransform;
    animation.animations.push(
      element.animate(
        [
          { transform: `translateY(${verticalOffset}px) ${baseTransform}`.trim() },
          { transform: originalTransform },
        ],
        { duration: animation.duration, easing: animation.verticalEasing, fill: 'both' },
      ),
    );
  }
}

/** Capture the visible timestamp and each reaction before their layout changes. */
export function captureReactionLayoutParts(bubble: HTMLElement): ReactionLayoutParts {
  const reactions = new Map<string, DOMRect>();
  for (const [emoji, position] of getReactions(bubble)) {
    reactions.set(emoji, position.getBoundingClientRect());
  }
  return { metadata: getMetadata(bubble)?.getBoundingClientRect(), reactions };
}

/** Give metadata and reactions their own movement after subtracting the parent row's movement. */
export function animateReactionLayoutParts(options: PartAnimationOptions) {
  const { bubble, previous } = options;
  const destinations = new Map<HTMLElement, DOMRect>();
  const metadata = getMetadata(bubble);
  if (metadata && previous.metadata) {
    const after = metadata.getBoundingClientRect();
    destinations.set(metadata, after);
    animatePart({
      element: metadata,
      before: previous.metadata,
      after,
      isMetadata: true,
      animation: options,
    });
  }
  for (const [emoji, position] of getReactions(bubble)) {
    const after = position.getBoundingClientRect();
    destinations.set(position, after);
    animatePart({
      element: position,
      before: previous.reactions.get(emoji),
      after,
      isMetadata: false,
      animation: options,
    });
  }
  return destinations;
}
