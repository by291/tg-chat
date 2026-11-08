import { expect, it } from 'vitest';
import { renderGradientPixels } from './freeformGradient';

const RGBA_CHANNEL_COUNT = 4;
// prettier-ignore
const UNIFORM_PIXEL = [
  18,
  52,
  86,
  255,
];
// prettier-ignore
const CORNER_COLORS = [
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#ffffff',
];

it('keeps a single-color background uniform and opaque', () => {
  const pixels = renderGradientPixels(['#123456']);
  for (let index = 0; index < pixels.length; index += RGBA_CHANNEL_COUNT) {
    expect(Array.from(pixels.slice(index, index + RGBA_CHANNEL_COUNT))).toEqual(UNIFORM_PIXEL);
  }
});

it('blends all corners without transparent seams', () => {
  const pixels = renderGradientPixels(CORNER_COLORS);
  expect(new Set(pixels).size).toBeGreaterThan(10);
  for (let index = 3; index < pixels.length; index += RGBA_CHANNEL_COUNT) {
    expect(pixels[index]).toBe(255);
  }
});
