/*
 * Adapted from Telegram Web K's groupedLayout.ts and prepareAlbum.ts.
 * Original layout algorithm: Telegram Desktop, licensed under GPL-3.0.
 * https://github.com/morethanwords/tweb/blob/master/src/components/groupedLayout.ts
 * https://github.com/telegramdesktop/tdesktop/blob/master/LEGAL
 * SPDX-License-Identifier: GPL-3.0-only
 */

const ITEM_SPACING = 1;
const MIN_ITEM_WIDTH = 100;
const WIDE_RATIO = 1.2;
const NARROW_RATIO = 0.8;
const COMPLEX_LAYOUT_RATIO = 2;
const COMPLEX_LAYOUT_ITEM_COUNT = 5;
const STACKED_PAIR_RATIO = 1.4;
const SIMILAR_RATIO_DIFFERENCE = 0.2;
const PAIR_MINIMUM_WIDTH_FACTOR = 1.5;
const SECOND_COLUMN_MINIMUM_SHARE = 0.4;
const LEADING_ROW_MAXIMUM_SHARE = 0.66;
const FIRST_BOTTOM_ITEM_MAXIMUM_SHARE = 0.4;
const LAST_BOTTOM_ITEM_MINIMUM_SHARE = 0.33;
const LEADING_COLUMN_MAXIMUM_SHARE = 0.6;
const COMPLEX_HEIGHT_NUMERATOR = 4;
const COMPLEX_HEIGHT_DENOMINATOR = 3;
const LANDSCAPE_AVERAGE_RATIO = 1.1;
const PORTRAIT_AVERAGE_RATIO = 0.85;
const MIN_CROPPED_RATIO = 0.6667;
const MAX_CROPPED_RATIO = 2.75;
const MAX_ITEMS_PER_ROW = 3;
const MAX_PORTRAIT_MIDDLE_ITEMS = 4;
const MIN_COMPLEX_ROWS = 2;
const MAX_COMPLEX_ROWS = 4;
const UNBALANCED_LAYOUT_PENALTY = 1.5;
const AVERAGE_RATIO_SEED = 1;

export interface AlbumLayoutItem {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AlbumLayout {
  width: number;
  height: number;
  items: AlbumLayoutItem[];
}

interface AlbumDimensions {
  width: number;
  height: number;
}

interface AlbumLayoutOptions {
  items: readonly AlbumDimensions[];
  maxWidth: number;
}

interface LayoutContext {
  dimensions: readonly AlbumDimensions[];
  ratios: number[];
  averageRatio: number;
  maxWidth: number;
}

interface RowAttempt {
  counts: number[];
  heights: number[];
}

interface RowSearchOptions {
  remainingItems: number;
  rowCount: number;
  counts: number[];
  averageRatio: number;
}

function sumValues(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function layoutStackedPair({ ratios, maxWidth }: LayoutContext): AlbumLayoutItem[] {
  const height = Math.round(
    Math.min(maxWidth / ratios[0], maxWidth / ratios[1], (maxWidth - ITEM_SPACING) / 2),
  );

  return [
    {
      left: 0,
      top: 0,
      width: maxWidth,
      height,
    },
    {
      left: 0,
      top: height + ITEM_SPACING,
      width: maxWidth,
      height,
    },
  ];
}

function layoutEqualPair({ ratios, maxWidth }: LayoutContext): AlbumLayoutItem[] {
  const width = (maxWidth - ITEM_SPACING) / 2;
  const height = Math.round(Math.min(width / ratios[0], width / ratios[1], maxWidth));

  return [
    {
      left: 0,
      top: 0,
      width,
      height,
    },
    {
      left: width + ITEM_SPACING,
      top: 0,
      width,
      height,
    },
  ];
}

function layoutUnequalPair({ ratios, maxWidth }: LayoutContext): AlbumLayoutItem[] {
  const minimumWidth = Math.round(MIN_ITEM_WIDTH * PAIR_MINIMUM_WIDTH_FACTOR);
  const availableWidth = maxWidth - ITEM_SPACING;
  const proportionalWidth = availableWidth / ratios[0] / (1 / ratios[0] + 1 / ratios[1]);
  const secondWidth = Math.min(
    Math.round(Math.max(SECOND_COLUMN_MINIMUM_SHARE * availableWidth, proportionalWidth)),
    availableWidth - minimumWidth,
  );
  const firstWidth = availableWidth - secondWidth;
  const height = Math.min(
    maxWidth,
    Math.round(Math.min(firstWidth / ratios[0], secondWidth / ratios[1])),
  );

  return [
    {
      left: 0,
      top: 0,
      width: firstWidth,
      height,
    },
    {
      left: firstWidth + ITEM_SPACING,
      top: 0,
      width: secondWidth,
      height,
    },
  ];
}

function layoutPair(context: LayoutContext): AlbumLayoutItem[] {
  const { ratios, averageRatio } = context;
  const isWidePair = ratios.every((ratio) => ratio > WIDE_RATIO);
  const isSquarePair = ratios.every((ratio) => ratio >= NARROW_RATIO && ratio <= WIDE_RATIO);
  const shouldStack =
    isWidePair &&
    averageRatio > STACKED_PAIR_RATIO &&
    ratios[1] - ratios[0] < SIMILAR_RATIO_DIFFERENCE;

  if (shouldStack) {
    return layoutStackedPair(context);
  }

  if (isWidePair || isSquarePair) {
    return layoutEqualPair(context);
  }

  return layoutUnequalPair(context);
}

function layoutThreeWithLeadingColumn({ ratios, maxWidth }: LayoutContext): AlbumLayoutItem[] {
  const thirdHeight = Math.round(
    Math.min(
      (maxWidth - ITEM_SPACING) / 2,
      (ratios[1] * (maxWidth - ITEM_SPACING)) / (ratios[2] + ratios[1]),
    ),
  );
  const secondHeight = maxWidth - thirdHeight - ITEM_SPACING;
  const rightWidth = Math.max(
    MIN_ITEM_WIDTH,
    Math.round(
      Math.min((maxWidth - ITEM_SPACING) / 2, thirdHeight * ratios[2], secondHeight * ratios[1]),
    ),
  );
  const leftWidth = Math.min(
    Math.round(maxWidth * ratios[0]),
    maxWidth - ITEM_SPACING - rightWidth,
  );

  return [
    {
      left: 0,
      top: 0,
      width: leftWidth,
      height: maxWidth,
    },
    {
      left: leftWidth + ITEM_SPACING,
      top: 0,
      width: rightWidth,
      height: secondHeight,
    },
    {
      left: leftWidth + ITEM_SPACING,
      top: secondHeight + ITEM_SPACING,
      width: rightWidth,
      height: thirdHeight,
    },
  ];
}

function layoutThreeWithLeadingRow({ ratios, maxWidth }: LayoutContext): AlbumLayoutItem[] {
  const firstHeight = Math.round(
    Math.min(maxWidth / ratios[0], (maxWidth - ITEM_SPACING) * LEADING_ROW_MAXIMUM_SHARE),
  );
  const secondWidth = (maxWidth - ITEM_SPACING) / 2;
  const secondHeight = Math.min(
    maxWidth - firstHeight - ITEM_SPACING,
    Math.round(Math.min(secondWidth / ratios[1], secondWidth / ratios[2])),
  );

  return [
    {
      left: 0,
      top: 0,
      width: maxWidth,
      height: firstHeight,
    },
    {
      left: 0,
      top: firstHeight + ITEM_SPACING,
      width: secondWidth,
      height: secondHeight,
    },
    {
      left: secondWidth + ITEM_SPACING,
      top: firstHeight + ITEM_SPACING,
      width: maxWidth - secondWidth - ITEM_SPACING,
      height: secondHeight,
    },
  ];
}

function layoutFourWithLeadingRow({ ratios, maxWidth }: LayoutContext): AlbumLayoutItem[] {
  const firstHeight = Math.round(
    Math.min(maxWidth / ratios[0], (maxWidth - ITEM_SPACING) * LEADING_ROW_MAXIMUM_SHARE),
  );
  const availableWidth = maxWidth - 2 * ITEM_SPACING;
  const naturalBottomHeight = Math.round(availableWidth / (ratios[1] + ratios[2] + ratios[3]));
  const firstBottomWidth = Math.max(
    MIN_ITEM_WIDTH,
    Math.round(
      Math.min(availableWidth * FIRST_BOTTOM_ITEM_MAXIMUM_SHARE, naturalBottomHeight * ratios[1]),
    ),
  );
  const lastBottomWidth = Math.round(
    Math.max(
      MIN_ITEM_WIDTH,
      availableWidth * LAST_BOTTOM_ITEM_MINIMUM_SHARE,
      naturalBottomHeight * ratios[3],
    ),
  );
  const middleBottomWidth = availableWidth - firstBottomWidth - lastBottomWidth;
  const bottomHeight = Math.min(maxWidth - firstHeight - ITEM_SPACING, naturalBottomHeight);
  const bottomTop = firstHeight + ITEM_SPACING;

  return [
    {
      left: 0,
      top: 0,
      width: maxWidth,
      height: firstHeight,
    },
    {
      left: 0,
      top: bottomTop,
      width: firstBottomWidth,
      height: bottomHeight,
    },
    {
      left: firstBottomWidth + ITEM_SPACING,
      top: bottomTop,
      width: middleBottomWidth,
      height: bottomHeight,
    },
    {
      left: firstBottomWidth + middleBottomWidth + 2 * ITEM_SPACING,
      top: bottomTop,
      width: lastBottomWidth,
      height: bottomHeight,
    },
  ];
}

function layoutFourWithLeadingColumn({ ratios, maxWidth }: LayoutContext): AlbumLayoutItem[] {
  const leftWidth = Math.round(
    Math.min(maxWidth * ratios[0], (maxWidth - ITEM_SPACING) * LEADING_COLUMN_MAXIMUM_SHARE),
  );
  const naturalRightWidth = Math.round(
    (maxWidth - 2 * ITEM_SPACING) / (1 / ratios[1] + 1 / ratios[2] + 1 / ratios[3]),
  );
  const firstRightHeight = Math.round(naturalRightWidth / ratios[1]);
  const secondRightHeight = Math.round(naturalRightWidth / ratios[2]);
  const thirdRightHeight = maxWidth - firstRightHeight - secondRightHeight - 2 * ITEM_SPACING;
  const rightWidth = Math.max(
    MIN_ITEM_WIDTH,
    Math.min(maxWidth - leftWidth - ITEM_SPACING, naturalRightWidth),
  );
  const rightLeft = leftWidth + ITEM_SPACING;

  return [
    {
      left: 0,
      top: 0,
      width: leftWidth,
      height: maxWidth,
    },
    {
      left: rightLeft,
      top: 0,
      width: rightWidth,
      height: firstRightHeight,
    },
    {
      left: rightLeft,
      top: firstRightHeight + ITEM_SPACING,
      width: rightWidth,
      height: secondRightHeight,
    },
    {
      left: rightLeft,
      top: firstRightHeight + secondRightHeight + 2 * ITEM_SPACING,
      width: rightWidth,
      height: thirdRightHeight,
    },
  ];
}

function cropRatios({ ratios, averageRatio }: LayoutContext) {
  const isLandscapeAlbum = averageRatio > LANDSCAPE_AVERAGE_RATIO;
  const minimumRatio = isLandscapeAlbum ? 1 : MIN_CROPPED_RATIO;
  const maximumRatio = isLandscapeAlbum ? MAX_CROPPED_RATIO : 1;

  return ratios.map((ratio) => Math.max(minimumRatio, Math.min(maximumRatio, ratio)));
}

function enumerateRowCounts(options: RowSearchOptions): number[][] {
  const { remainingItems, rowCount, counts, averageRatio } = options;

  if (counts.length === rowCount) {
    return remainingItems === 0 ? [counts] : [];
  }

  const isPortraitMiddleRow =
    rowCount === 3 && counts.length === 1 && averageRatio < PORTRAIT_AVERAGE_RATIO;
  const maximumItems = isPortraitMiddleRow ? MAX_PORTRAIT_MIDDLE_ITEMS : MAX_ITEMS_PER_ROW;
  const remainingRows = rowCount - counts.length - 1;
  const rowLimit = Math.min(maximumItems, remainingItems - remainingRows);
  const candidates: number[][] = [];

  // Ascending row sizes preserve upstream tie-breaking when candidate scores are equal.
  for (let count = 1; count <= rowLimit; count += 1) {
    const nextCounts = [...counts, count];
    candidates.push(
      ...enumerateRowCounts({
        remainingItems: remainingItems - count,
        rowCount,
        counts: nextCounts,
        averageRatio,
      }),
    );
  }

  return candidates;
}

function measureRows(counts: number[], context: LayoutContext): RowAttempt {
  let offset = 0;
  const heights: number[] = [];

  for (const count of counts) {
    const rowRatios = context.ratios.slice(offset, offset + count);
    const availableWidth = context.maxWidth - (count - 1) * ITEM_SPACING;
    heights.push(availableWidth / sumValues(rowRatios));
    offset += count;
  }

  return { counts, heights };
}

function scoreRows(attempt: RowAttempt, maxWidth: number) {
  const { counts, heights } = attempt;
  const totalHeight = sumValues(heights) + ITEM_SPACING * (counts.length - 1);
  const hasShortRow = Math.min(...heights) < MIN_ITEM_WIDTH;
  const hasDecreasingRow = counts.some((count, index) => index > 0 && counts[index - 1] > count);
  const shortRowPenalty = hasShortRow ? UNBALANCED_LAYOUT_PENALTY : 1;
  const decreasingRowPenalty = hasDecreasingRow ? UNBALANCED_LAYOUT_PENALTY : 1;
  const targetHeight = (maxWidth * COMPLEX_HEIGHT_NUMERATOR) / COMPLEX_HEIGHT_DENOMINATOR;

  return Math.abs(totalHeight - targetHeight) * shortRowPenalty * decreasingRowPenalty;
}

function selectRows(context: LayoutContext): RowAttempt {
  const candidates: number[][] = [];

  for (let rowCount = MIN_COMPLEX_ROWS; rowCount <= MAX_COMPLEX_ROWS; rowCount += 1) {
    candidates.push(
      ...enumerateRowCounts({
        remainingItems: context.ratios.length,
        rowCount,
        counts: [],
        averageRatio: context.averageRatio,
      }),
    );
  }

  let bestAttempt = measureRows(candidates[0], context);
  let bestScore = scoreRows(bestAttempt, context.maxWidth);

  for (const counts of candidates.slice(1)) {
    const attempt = measureRows(counts, context);
    const score = scoreRows(attempt, context.maxWidth);

    if (score < bestScore) {
      bestAttempt = attempt;
      bestScore = score;
    }
  }

  return bestAttempt;
}

function layoutComplex(context: LayoutContext): AlbumLayoutItem[] {
  const ratios = cropRatios(context);
  const attempt = selectRows({ ...context, ratios });
  const items: AlbumLayoutItem[] = [];
  let index = 0;
  let top = 0;

  for (let row = 0; row < attempt.counts.length; row += 1) {
    const count = attempt.counts[row];
    const naturalHeight = attempt.heights[row];
    const height = Math.round(naturalHeight);
    let left = 0;

    for (let column = 0; column < count; column += 1) {
      const isLastColumn = column === count - 1;
      // The last tile absorbs rounding so every row reaches the same right edge.
      const width = isLastColumn
        ? context.maxWidth - left
        : Math.round(ratios[index] * naturalHeight);
      items.push({
        left,
        top,
        width,
        height,
      });
      left += width + ITEM_SPACING;
      index += 1;
    }

    top += height + ITEM_SPACING;
  }

  return items;
}

function layoutSpecialized(context: LayoutContext): AlbumLayoutItem[] {
  const { ratios } = context;

  if (ratios.length === 2) {
    return layoutPair(context);
  }

  if (ratios.length === 3) {
    return ratios[0] < NARROW_RATIO
      ? layoutThreeWithLeadingColumn(context)
      : layoutThreeWithLeadingRow(context);
  }

  return ratios[0] > WIDE_RATIO
    ? layoutFourWithLeadingRow(context)
    : layoutFourWithLeadingColumn(context);
}

function isUsableTile(item: AlbumLayoutItem, maxWidth: number) {
  // prettier-ignore
  const measurements = [
    item.left,
    item.top,
    item.width,
    item.height,
  ];
  const hasFiniteMeasurements = measurements.every(Number.isFinite);
  const hasPositiveSize = item.width > 0 && item.height > 0;
  const hasValidPosition = item.left >= 0 && item.top >= 0;
  const isWithinWidth = item.left + item.width <= maxWidth;

  return hasFiniteMeasurements && hasPositiveSize && hasValidPosition && isWithinWidth;
}

function isSeparatedPair(first: AlbumLayoutItem, second: AlbumLayoutItem) {
  const hasHorizontalGap =
    first.left + first.width + ITEM_SPACING <= second.left ||
    second.left + second.width + ITEM_SPACING <= first.left;
  const hasVerticalGap =
    first.top + first.height + ITEM_SPACING <= second.top ||
    second.top + second.height + ITEM_SPACING <= first.top;

  return hasHorizontalGap || hasVerticalGap;
}

function isUsableLayout(items: AlbumLayoutItem[], maxWidth: number) {
  if (!items.every((item) => isUsableTile(item, maxWidth))) {
    return false;
  }

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (!isSeparatedPair(items[i], items[j])) {
        return false;
      }
    }
  }

  return true;
}

function layoutItems(context: LayoutContext): AlbumLayoutItem[] {
  const { ratios, maxWidth } = context;

  if (ratios.length === 0) {
    return [];
  }

  if (ratios.length === 1) {
    return [
      {
        left: 0,
        top: 0,
        width: maxWidth,
        height: (context.dimensions[0].height * maxWidth) / context.dimensions[0].width,
      },
    ];
  }

  const shouldUseComplexLayout =
    ratios.length >= COMPLEX_LAYOUT_ITEM_COUNT ||
    ratios.some((ratio) => ratio > COMPLEX_LAYOUT_RATIO);

  if (shouldUseComplexLayout) {
    return layoutComplex(context);
  }

  const specializedItems = layoutSpecialized(context);

  if (isUsableLayout(specializedItems, maxWidth)) {
    return specializedItems;
  }

  // Upstream minimum-width allocations can leave another tile with zero or negative space.
  return layoutComplex(context);
}

/** Reserve Telegram's ordered album tiles from source dimensions before media decoding. */
export function getAlbumLayout({ items, maxWidth }: AlbumLayoutOptions): AlbumLayout {
  const ratios = items.map((item) => item.width / item.height);
  // Telegram seeds this average with one; changing it changes row selection and cropping.
  const ratioTotal = ratios.reduce((total, ratio) => total + ratio, AVERAGE_RATIO_SEED);
  const averageRatio = ratioTotal / ratios.length;
  const layout = layoutItems({
    dimensions: items,
    ratios,
    averageRatio,
    maxWidth,
  });

  return {
    width: Math.max(0, ...layout.map((item) => item.left + item.width)),
    height: Math.max(0, ...layout.map((item) => item.top + item.height)),
    items: layout,
  };
}
