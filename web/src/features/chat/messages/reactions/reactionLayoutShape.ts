const GRID_SIDE_COUNT = 3;
const LAST_GRID_INDEX = GRID_SIDE_COUNT - 1;
const BAND_OVERLAP = 1;
const BOX_SHADOW_BLUR_RATIO = 2;

interface ShapeSize {
  width: number;
  height: number;
}

interface ShapeOptions {
  bubble: HTMLElement;
  before: ShapeSize;
  after: ShapeSize;
  duration: number;
  horizontalEasing: string;
  verticalEasing: string;
  animations: Animation[];
}

interface ShapeRectangle extends ShapeSize {
  left: number;
  top: number;
}

interface AxisSegmentOptions {
  size: number;
  corner: number;
  index: number;
}

function getAxisSegment(options: AxisSegmentOptions) {
  const { size, corner, index } = options;
  if (index === 0) {
    return { start: 0, size: corner };
  }
  if (index === LAST_GRID_INDEX) {
    return { start: size - corner, size: corner };
  }
  // A pixel of overlap keeps compositor rounding from exposing seams between neighboring bands.
  return {
    start: corner - BAND_OVERLAP,
    size: size - corner * 2 + BAND_OVERLAP * 2,
  };
}

function getShapeShadow(boxShadow: string) {
  const shadows = boxShadow.split(/,(?![^(]*\))/);
  const filters: string[] = [];
  for (const shadow of shadows) {
    const color = shadow.match(/[a-z-]+\([^)]*\)|#[\da-f]+/i)?.[0];
    const lengths = color ? shadow.replace(color, '').match(/-?[\d.]+px/g) : undefined;
    if (!color || !lengths || lengths.length < 2 || shadow.includes('inset')) {
      continue;
    }
    // CSS box-shadow's blur radius is twice drop-shadow's Gaussian standard deviation.
    const blur = (Number.parseFloat(lengths[2]) || 0) / BOX_SHADOW_BLUR_RATIO;
    filters.push(`drop-shadow(${lengths[0]} ${lengths[1]} ${blur}px ${color})`);
  }
  return filters.join(' ');
}

function getPieceRectangle(options: {
  size: ShapeSize;
  corner: number;
  column: number;
  row: number;
}): ShapeRectangle {
  const { size, corner, column, row } = options;
  const horizontal = getAxisSegment({
    size: size.width,
    corner,
    index: column,
  });
  const vertical = getAxisSegment({
    size: size.height,
    corner,
    index: row,
  });
  return {
    left: horizontal.start,
    top: vertical.start,
    width: horizontal.size,
    height: vertical.size,
  };
}

function createShapePiece(options: {
  before: ShapeRectangle;
  after: ShapeRectangle;
  background: string;
  duration: number;
  horizontalEasing: string;
  verticalEasing: string;
  animations: Animation[];
}) {
  const { before, after, animations } = options;
  const across = document.createElement('div');
  const piece = document.createElement('div');
  Object.assign(across.style, {
    position: 'absolute',
    left: `${after.left}px`,
    top: `${after.top}px`,
    width: `${after.width}px`,
    height: `${after.height}px`,
    transformOrigin: 'top left',
  });
  Object.assign(piece.style, {
    width: '100%',
    height: '100%',
    background: options.background,
    transformOrigin: 'top left',
  });
  across.append(piece);
  const initialHorizontal = `translateX(${before.left - after.left}px) scaleX(${before.width / after.width})`;
  const initialVertical = `translateY(${before.top - after.top}px) scaleY(${before.height / after.height})`;
  animations.push(
    across.animate([{ transform: initialHorizontal }, { transform: 'translateX(0px) scaleX(1)' }], {
      duration: options.duration,
      easing: options.horizontalEasing,
      fill: 'both',
    }),
    piece.animate([{ transform: initialVertical }, { transform: 'translateY(0px) scaleY(1)' }], {
      duration: options.duration,
      easing: options.verticalEasing,
      fill: 'both',
    }),
  );

  return { across, piece };
}

function animateShapeTail(options: ShapeOptions) {
  const { bubble, before, after, animations } = options;
  const tail = bubble.querySelector<SVGElement>('[data-message-tail]');
  if (!tail) {
    return;
  }

  const isOwn = bubble.closest('[data-own="true"]') !== null;
  const horizontalOffset = isOwn ? before.width - after.width : 0;
  const verticalOffset = before.height - after.height;
  if (horizontalOffset !== 0) {
    // The row moves from its old left edge; an outgoing tail must stay at the fixed right edge.
    animations.push(
      tail.animate([{ translate: `${horizontalOffset}px 0px` }, { translate: '0px 0px' }], {
        duration: options.duration,
        easing: options.horizontalEasing,
        fill: 'both',
      }),
    );
  }
  if (verticalOffset !== 0) {
    const originalTransform = getComputedStyle(tail).transform;
    const baseTransform = originalTransform === 'none' ? '' : originalTransform;
    animations.push(
      tail.animate(
        [
          { transform: `translateY(${verticalOffset}px) ${baseTransform}`.trim() },
          { transform: originalTransform },
        ],
        {
          duration: options.duration,
          easing: options.verticalEasing,
          fill: 'both',
        },
      ),
    );
  }
}

/** Stretch only background bands so real message text and rounded corners keep their size. */
export function animateReactionLayoutShape(options: ShapeOptions): () => void {
  const { bubble, before, after, animations } = options;
  const computedStyle = getComputedStyle(bubble);
  const radii = {
    topLeft: computedStyle.borderTopLeftRadius,
    topRight: computedStyle.borderTopRightRadius,
    bottomLeft: computedStyle.borderBottomLeftRadius,
    bottomRight: computedStyle.borderBottomRightRadius,
  };
  const largestRadius = Math.max(...Object.values(radii).map((radius) => parseFloat(radius) || 0));
  const smallestDimension = Math.min(before.width, before.height, after.width, after.height);
  const corner = Math.min(Math.max(1, largestRadius), (smallestDimension - 1) / 2);
  const shell = document.createElement('div');
  shell.dataset.reactionLayoutShell = '';
  shell.setAttribute('aria-hidden', 'true');
  Object.assign(shell.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '-1',
    pointerEvents: 'none',
    filter: getShapeShadow(computedStyle.boxShadow),
  });

  for (let row = 0; row < GRID_SIDE_COUNT; row += 1) {
    for (let column = 0; column < GRID_SIDE_COUNT; column += 1) {
      const { across, piece } = createShapePiece({
        before: getPieceRectangle({
          size: before,
          corner,
          column,
          row,
        }),
        after: getPieceRectangle({
          size: after,
          corner,
          column,
          row,
        }),
        background: computedStyle.background,
        duration: options.duration,
        horizontalEasing: options.horizontalEasing,
        verticalEasing: options.verticalEasing,
        animations,
      });
      piece.style.borderTopLeftRadius = row === 0 && column === 0 ? radii.topLeft : '0';
      piece.style.borderTopRightRadius =
        row === 0 && column === LAST_GRID_INDEX ? radii.topRight : '0';
      piece.style.borderBottomLeftRadius =
        row === LAST_GRID_INDEX && column === 0 ? radii.bottomLeft : '0';
      piece.style.borderBottomRightRadius =
        row === LAST_GRID_INDEX && column === LAST_GRID_INDEX ? radii.bottomRight : '0';
      shell.append(across);
    }
  }

  const background = bubble.style.background;
  const shadow = bubble.style.boxShadow;
  const transitionProperty = bubble.style.transitionProperty;
  // The original shadow must disappear immediately; fading it would expose the final-size box.
  bubble.style.transitionProperty = 'none';
  bubble.style.background = 'transparent';
  bubble.style.boxShadow = 'none';
  bubble.prepend(shell);
  animateShapeTail(options);

  return () => {
    bubble.style.background = background;
    bubble.style.boxShadow = shadow;
    // Commit the restored shadow with transitions disabled before restoring ordinary hover effects.
    bubble.getBoundingClientRect();
    bubble.style.transitionProperty = transitionProperty;
    shell.remove();
  };
}
