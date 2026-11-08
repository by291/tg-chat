// prettier-ignore
const HEX_CHANNEL_OFFSETS = [
  1,
  3,
  5,
];

const RGB_MAXIMUM = 255;
const HUE_SECTOR = 60;
const FULL_ROTATION = 360;

/** Derive a tint using the HSV multipliers used by Telegram's Dark theme. */
export function multiplyThemeColor({
  color,
  hue,
  saturation,
  brightness,
}: {
  color: string;
  hue: number;
  saturation: number;
  brightness: number;
}) {
  const channels = HEX_CHANNEL_OFFSETS.map((offset) => {
    return parseInt(color.slice(offset, offset + 2), 16) / RGB_MAXIMUM;
  });
  const [red, green, blue] = channels;
  const maximum = Math.max(...channels);
  const minimum = Math.min(...channels);
  const delta = maximum - minimum;
  let originalHue = 0;
  if (delta !== 0) {
    if (maximum === red) {
      originalHue = ((green - blue) / delta) % 6;
    } else if (maximum === green) {
      originalHue = (blue - red) / delta + 2;
    } else {
      originalHue = (red - green) / delta + 4;
    }
  }
  const normalizedHue = (originalHue * HUE_SECTOR + FULL_ROTATION) % FULL_ROTATION;
  const nextHue = ((normalizedHue * hue) % FULL_ROTATION) / HUE_SECTOR;
  const nextSaturation = Math.min(1, (maximum === 0 ? 0 : delta / maximum) * saturation);
  const nextBrightness = Math.min(1, Math.max(maximum, 0.18) * brightness);
  const chroma = nextBrightness * nextSaturation;
  const intermediate = chroma * (1 - Math.abs((nextHue % 2) - 1));
  // prettier-ignore
  const sectors = [
    [
      chroma,
      intermediate,
      0,
    ],
    [
      intermediate,
      chroma,
      0,
    ],
    [
      0,
      chroma,
      intermediate,
    ],
    [
      0,
      intermediate,
      chroma,
    ],
    [
      intermediate,
      0,
      chroma,
    ],
    [
      chroma,
      0,
      intermediate,
    ],
  ];
  const nextChannels = sectors[Math.floor(nextHue) % sectors.length];
  const hexChannels = nextChannels.map((channel) => {
    const value = Math.round((channel + nextBrightness - chroma) * RGB_MAXIMUM);
    return value.toString(16).padStart(2, '0');
  });
  return `#${hexChannels.join('')}`;
}

/** Compose a four-corner gradient with a stable fallback for one-color backgrounds. */
export function wallpaperGradient(colors: string[]) {
  const [first, second = first, third = first, fourth = second] = colors;
  return [
    `radial-gradient(ellipse at 75% 8%, ${third} 0, transparent 60%)`,
    `radial-gradient(ellipse at 15% 95%, ${fourth} 0, transparent 65%)`,
    `linear-gradient(135deg, ${first}, ${second})`,
  ].join(', ');
}
