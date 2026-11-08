// prettier-ignore
const HEX_CHANNEL_OFFSETS = [
  1,
  3,
  5,
];

/*
 * Adapted from Telegram Web K's helpers/freeformGradient.ts, GPL-3.0.
 * Copyright (C) 2019-2021 Artem Kolnogorov and the original gradient script author.
 */
export const GRADIENT_SIZE = 50;
const CHANNEL_COUNT = 4;
const MAXIMUM_CHANNEL = 255;
const CENTER = 0.5;
const SWIRL_FACTOR = 0.35;
const SWIRL_ROTATION = 6.4;
const COLOR_RADIUS = 0.9;
const COLOR_FALLOFF_EXPONENT = 4;
const COLOR_POSITIONS = [
  { left: 0.8, top: 0.9 },
  { left: 0.35, top: 0.75 },
  { left: 0.2, top: 0.1 },
  { left: 0.65, top: 0.25 },
];

function swirlPoint({ left, top }: { left: number; top: number }) {
  const horizontal = left - CENTER;
  const vertical = top - CENTER;
  const distance = Math.hypot(horizontal, vertical);
  const rotation = (SWIRL_FACTOR * distance) ** 2 * SWIRL_ROTATION;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);

  return {
    left: Math.max(0, Math.min(1, CENTER + horizontal * cosine - vertical * sine)),
    top: Math.max(0, Math.min(1, CENTER + horizontal * sine + vertical * cosine)),
  };
}

function blendPixel({
  point,
  colors,
}: {
  point: { left: number; top: number };
  colors: number[][];
}) {
  let weightSum = 0;
  const channels = new Array<number>(HEX_CHANNEL_OFFSETS.length).fill(0);

  for (let index = 0; index < colors.length; index += 1) {
    const position = COLOR_POSITIONS[index];
    const distance = Math.hypot(point.left - position.left, point.top - position.top);
    const weight = Math.max(0, COLOR_RADIUS - distance) ** COLOR_FALLOFF_EXPONENT;
    weightSum += weight;
    for (let channel = 0; channel < channels.length; channel += 1) {
      channels[channel] += weight * colors[index][channel];
    }
  }

  if (weightSum === 0) {
    return colors[0];
  }

  return channels.map((channel) => channel / weightSum);
}

/** Render Telegram's four-point freeform wallpaper at its native low-resolution raster size. */
export function renderGradientPixels(colors: string[]) {
  const rgb = colors.slice(0, COLOR_POSITIONS.length).map((color) => {
    return HEX_CHANNEL_OFFSETS.map((offset) => parseInt(color.slice(offset, offset + 2), 16));
  });
  const pixels = new Uint8ClampedArray(GRADIENT_SIZE * GRADIENT_SIZE * CHANNEL_COUNT);

  for (let row = 0; row < GRADIENT_SIZE; row += 1) {
    for (let column = 0; column < GRADIENT_SIZE; column += 1) {
      const point = swirlPoint({ left: column / GRADIENT_SIZE, top: row / GRADIENT_SIZE });
      const channels = blendPixel({ point, colors: rgb });
      const offset = (row * GRADIENT_SIZE + column) * CHANNEL_COUNT;
      pixels.set(channels, offset);
      pixels[offset + CHANNEL_COUNT - 1] = MAXIMUM_CHANNEL;
    }
  }

  return pixels;
}
