import { describe, expect, it } from 'vitest';
import { getAlbumLayout, type AlbumLayout, type AlbumLayoutItem } from './albumLayout';

const DESKTOP_WIDTH = 420;
const MOBILE_WIDTH = 340;
const ITEM_SPACING = 1;
const MAX_ALBUM_ITEMS = 10;
const MIXED_DIMENSIONS = [
  { width: 600, height: 900 },
  { width: 1200, height: 800 },
  { width: 800, height: 800 },
  { width: 1600, height: 700 },
  { width: 700, height: 1200 },
  { width: 1000, height: 600 },
  { width: 900, height: 900 },
  { width: 800, height: 1100 },
  { width: 1400, height: 900 },
  { width: 600, height: 1000 },
];

function expectSeparated(first: AlbumLayoutItem, second: AlbumLayoutItem) {
  const hasHorizontalGap =
    first.left + first.width + ITEM_SPACING <= second.left ||
    second.left + second.width + ITEM_SPACING <= first.left;
  const hasVerticalGap =
    first.top + first.height + ITEM_SPACING <= second.top ||
    second.top + second.height + ITEM_SPACING <= first.top;

  expect(hasHorizontalGap || hasVerticalGap).toBe(true);
}

function expectValidBounds(layout: AlbumLayout) {
  for (const item of layout.items) {
    expect(item.width).toBeGreaterThan(0);
    expect(item.height).toBeGreaterThan(0);
    expect(item.left).toBeGreaterThanOrEqual(0);
    expect(item.top).toBeGreaterThanOrEqual(0);
    expect(item.left + item.width).toBeLessThanOrEqual(layout.width);
    expect(item.top + item.height).toBeLessThanOrEqual(layout.height);
  }

  for (let i = 0; i < layout.items.length; i += 1) {
    for (let j = i + 1; j < layout.items.length; j += 1) {
      expectSeparated(layout.items[i], layout.items[j]);
    }
  }
}

describe('Telegram album layout', () => {
  it('reserves no space for an empty album', () => {
    expect(getAlbumLayout({ items: [], maxWidth: DESKTOP_WIDTH })).toEqual({
      width: 0,
      height: 0,
      items: [],
    });
  });

  it('preserves a single image aspect ratio at the selected width', () => {
    const layout = getAlbumLayout({
      items: [{ width: 600, height: 900 }],
      maxWidth: MOBILE_WIDTH,
    });

    expect(layout.width).toBe(MOBILE_WIDTH);
    expect(layout.height).toBe(510);
    expectValidBounds(layout);
  });

  it('stacks two matching landscapes with an uninterrupted one-pixel gap', () => {
    const layout = getAlbumLayout({
      items: [
        { width: 1600, height: 900 },
        { width: 1600, height: 900 },
      ],
      maxWidth: DESKTOP_WIDTH,
    });

    expect(layout.items[0].width).toBe(DESKTOP_WIDTH);
    expect(layout.items[1].width).toBe(DESKTOP_WIDTH);
    expect(layout.items[1].top).toBe(layout.items[0].height + ITEM_SPACING);
    expectValidBounds(layout);
  });

  it('places two square images side by side without a trailing gap', () => {
    const layout = getAlbumLayout({
      items: [
        { width: 800, height: 800 },
        { width: 800, height: 800 },
      ],
      maxWidth: DESKTOP_WIDTH,
    });

    expect(layout.items[0].top).toBe(layout.items[1].top);
    expect(layout.items[0].width).toBe(layout.items[1].width);
    expect(layout.items[1].left).toBe(layout.items[0].width + ITEM_SPACING);
    expect(layout.items[1].left + layout.items[1].width).toBe(DESKTOP_WIDTH);
    expectValidBounds(layout);
  });

  it('gives the leading portrait a full-height column beside two stacked images', () => {
    const layout = getAlbumLayout({
      items: [
        { width: 600, height: 900 },
        { width: 800, height: 800 },
        { width: 1200, height: 800 },
      ],
      maxWidth: DESKTOP_WIDTH,
    });

    expect(layout.items[0].height).toBe(layout.height);
    expect(layout.items[1].left).toBe(layout.items[2].left);
    expect(layout.items[2].top).toBe(layout.items[1].height + ITEM_SPACING);
    expectValidBounds(layout);
  });

  it('places a leading landscape above two equal-width images', () => {
    const layout = getAlbumLayout({
      items: [
        { width: 1200, height: 800 },
        { width: 800, height: 800 },
        { width: 600, height: 900 },
      ],
      maxWidth: DESKTOP_WIDTH,
    });

    expect(layout.items[0].width).toBe(layout.width);
    expect(layout.items[1].top).toBe(layout.items[2].top);
    expect(layout.items[1].width).toBe(layout.items[2].width);
    expectValidBounds(layout);
  });

  it('places a leading landscape above a three-image row', () => {
    const layout = getAlbumLayout({
      items: [
        { width: 1200, height: 800 },
        { width: 800, height: 800 },
        { width: 600, height: 900 },
        { width: 1000, height: 800 },
      ],
      maxWidth: MOBILE_WIDTH,
    });

    expect(layout.items[0].width).toBe(layout.width);
    expect(new Set(layout.items.slice(1).map((item) => item.top)).size).toBe(1);
    expectValidBounds(layout);
  });

  it('places a leading square beside a three-image column', () => {
    const layout = getAlbumLayout({
      items: [
        { width: 800, height: 800 },
        { width: 1200, height: 800 },
        { width: 600, height: 900 },
        { width: 1000, height: 800 },
      ],
      maxWidth: MOBILE_WIDTH,
    });

    expect(layout.items[0].height).toBe(layout.height);
    expect(new Set(layout.items.slice(1).map((item) => item.left)).size).toBe(1);
    expectValidBounds(layout);
  });

  it('keeps every tile visible when two narrow portraits compete with a wide bottom image', () => {
    const layout = getAlbumLayout({
      items: [
        { width: 1200, height: 800 },
        { width: 400, height: 1000 },
        { width: 400, height: 1000 },
        { width: 1200, height: 600 },
      ],
      maxWidth: MOBILE_WIDTH,
    });

    expect(layout.items).toHaveLength(4);
    expect(layout.width).toBeLessThanOrEqual(MOBILE_WIDTH);
    expectValidBounds(layout);
  });

  it.each([DESKTOP_WIDTH, MOBILE_WIDTH])(
    'keeps mixed albums of one to ten images inside a %i-pixel frame without overlap',
    (maxWidth) => {
      for (let count = 1; count <= MAX_ALBUM_ITEMS; count += 1) {
        const layout = getAlbumLayout({
          items: MIXED_DIMENSIONS.slice(0, count),
          maxWidth,
        });

        expect(layout.items).toHaveLength(count);
        expect(layout.width).toBeLessThanOrEqual(maxWidth);
        expectValidBounds(layout);
      }
    },
  );

  it('uses balanced rows for a panorama without reordering its following images', () => {
    const layout = getAlbumLayout({
      items: [
        { width: 3000, height: 500 },
        { width: 900, height: 900 },
        { width: 600, height: 900 },
      ],
      maxWidth: DESKTOP_WIDTH,
    });

    expect(layout.items[0].top).toBe(0);
    expect(layout.items[0].top).toBe(layout.items[1].top);
    expect(layout.items[0].width).toBeGreaterThan(layout.items[1].width);
    expect(layout.items[0].left).toBeLessThan(layout.items[1].left);
    expect(layout.items[2].top).toBe(layout.items[0].height + ITEM_SPACING);
    expect(layout.items[2].width).toBe(DESKTOP_WIDTH);
    expectValidBounds(layout);
  });
});
