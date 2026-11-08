import presets from './themePresets';
import darkWallpapers from './darkWallpapers';
import type { ThemeChoice, ThemeVariant } from './appearanceStore';
import { multiplyThemeColor, wallpaperGradient } from './themeColors';

export const THEME_VARIANTS = [
  { id: 'classic', label: 'Classic' },
  { id: 'night', label: 'Night' },
  { id: 'day', label: 'Day' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System Default' },
] as const;

// Palette bundles come from tweb/src/config/themePresets.ts (Telegram iOS presets).
export const THEME_CARDS = [
  {
    id: 'default',
    label: 'Default',
    emoji: '🏠',
  },
  {
    id: 'diamond',
    label: 'Diamond',
    emoji: '💎',
  },
  ...presets,
];

export const ACCENT_COLORS = [
  { label: 'Blue', color: '#0088ff' },
  { label: 'Cyan', color: '#00c2ed' },
  { label: 'Green', color: '#29b327' },
  { label: 'Pink', color: '#eb6ca4' },
  { label: 'Orange', color: '#f08200' },
  { label: 'Purple', color: '#9472ee' },
  { label: 'Red', color: '#d33213' },
  { label: 'Yellow', color: '#edb400' },
  { label: 'Gray', color: '#6d839e' },
];

const DEFAULT_WALLPAPERS: Record<ThemeVariant, string[]> = {
  // prettier-ignore
  classic: [
    '#dbddbb',
    '#6ba587',
    '#d5d88d',
    '#88b884',
  ],
  // prettier-ignore
  night: [
    '#211b2b',
    '#281c34',
    '#342335',
    '#19243b',
  ],
  // prettier-ignore
  day: [
    '#b1e0fa',
    '#82b0d8',
    '#a0d8e8',
    '#e5f0f8',
  ],
  // prettier-ignore
  dark: [
    '#1e3557',
    '#182036',
    '#1c4352',
    '#16263a',
  ],
};

const DEFAULT_ACCENTS: Record<ThemeVariant, string> = {
  classic: '#3390ec',
  night: '#8774e1',
  day: '#2d7ed5',
  dark: '#0088ff',
};

interface PaletteOptions {
  variant: ThemeVariant;
  choice: ThemeChoice;
}

/** Identify the two dark palette variants independently of the selected wallpaper. */
export function isDarkVariant(variant: ThemeVariant) {
  return variant === 'night' || variant === 'dark';
}

/** Resolve source-derived preset colors for previews and the active application. */
export function getThemePalette({ variant, choice }: PaletteOptions) {
  const isDark = isDarkVariant(variant);
  const preset = presets.find((entry) => entry.id === choice.themeId);
  let accent = preset?.accent ?? DEFAULT_ACCENTS[variant];
  let wallpaper = preset?.wallpaper ?? DEFAULT_WALLPAPERS[variant];
  let bubbles = preset?.bubbles ?? ['#e3ffc9'];
  if (choice.themeId === 'diamond') {
    accent = isDark ? '#b279df' : '#bd5bd8';
    // prettier-ignore
    wallpaper = [
      '#c7b5ed',
      '#b9c8ec',
      '#efb7d5',
      '#9be2db',
    ];
    bubbles = ['#e2f7ff'];
  }
  if (variant === 'dark' && choice.accent) {
    accent = choice.accent;
  }
  if (isDark && (preset || choice.themeId === 'diamond')) {
    wallpaper = wallpaper.map((color) => {
      return multiplyThemeColor({
        color,
        hue: 1,
        saturation: 0.7,
        brightness: 0.25,
      });
    });
  }
  if (variant === 'dark' && choice.accent) {
    const accentWallpaper = darkWallpapers[choice.accent as keyof typeof darkWallpapers];
    wallpaper = accentWallpaper ?? DEFAULT_WALLPAPERS.dark;
  }
  if (isDark) {
    const bottom = multiplyThemeColor({
      color: accent,
      hue: 1.019,
      saturation: 0.731,
      brightness: 0.59,
    });
    const top = multiplyThemeColor({
      color: bottom,
      hue: 0.966,
      saturation: 0.61,
      brightness: 0.98,
    });
    bubbles = [top, bottom];
  } else if (variant === 'day') {
    bubbles = [accent];
  }

  const hasWhiteOutgoingText = isDark || variant === 'day';
  const outgoingMeta = hasWhiteOutgoingText ? '#e1e6f4' : accent;
  const outgoingText = hasWhiteOutgoingText ? '#ffffff' : '#000000';
  const outgoing = bubbles[bubbles.length - 1];
  const surface = isDark ? '#212121' : '#ffffff';
  const panel = isDark ? '#181818' : '#f4f4f5';
  const variables: Record<string, string> = {
    '--accent-color': accent,
    '--accent-hover': `color-mix(in srgb, ${accent}, black 10%)`,
    '--text-color': isDark ? '#ffffff' : '#191919',
    '--message-text-color': isDark ? '#ffffff' : '#000000',
    '--secondary-color': isDark ? '#aaaaaa' : '#707579',
    '--incoming-meta-color': isDark ? '#aaaaaa' : '#707579',
    '--surface-color': surface,
    '--panel-color': panel,
    '--input-color': panel,
    '--overlay-color': `color-mix(in srgb, ${surface} 96%, transparent)`,
    '--incoming-color': variant === 'day' ? '#f0f0f0' : surface,
    '--outgoing-color': outgoing,
    '--outgoing-gradient': `linear-gradient(${bubbles.join(', ')}, ${outgoing})`,
    '--outgoing-text-color': outgoingText,
    '--outgoing-meta-color': outgoingMeta,
    '--reply-color': `color-mix(in srgb, ${accent} 9%, transparent)`,
    '--service-color': `color-mix(in srgb, ${accent} 35%, #55555555)`,
    '--message-highlighting-color': `color-mix(in srgb, ${accent} 40%, transparent)`,
  };
  if (variant === 'dark') {
    applyDarkSurfaces({ variables, accent });
  }

  return {
    variables,
    wallpaper,
    accent,
    outgoing,
    outgoingText,
    isDark,
  };
}

function applyDarkSurfaces({
  variables,
  accent,
}: {
  variables: Record<string, string>;
  accent: string;
}) {
  // These multipliers match themeController's iOS-derived Tinted surface palette.
  const surface = multiplyThemeColor({
    color: accent,
    hue: 1.024,
    saturation: 0.585,
    brightness: 0.25,
  });
  const panel = multiplyThemeColor({
    color: accent,
    hue: 1.024,
    saturation: 0.573,
    brightness: 0.18,
  });
  variables['--surface-color'] = surface;
  variables['--incoming-color'] = surface;
  variables['--panel-color'] = panel;
  variables['--input-color'] = panel;
  variables['--overlay-color'] = `color-mix(in srgb, ${surface} 96%, transparent)`;
}

/** Resolve a wallpaper override without changing the theme's accent or bubble palette. */
export function getWallpaperAppearance({ variant, choice }: PaletteOptions) {
  if (choice.wallpaper?.kind === 'color') {
    return { background: choice.wallpaper.color, hasPattern: false };
  }

  let wallpaperChoice = choice;
  if (choice.wallpaper?.kind === 'gradient') {
    wallpaperChoice = {
      ...choice,
      themeId: choice.wallpaper.themeId,
      accent: null,
    };
  }

  const palette = getThemePalette({ variant, choice: wallpaperChoice });

  return {
    background: wallpaperGradient(palette.wallpaper),
    colors: palette.wallpaper,
    hasPattern: true,
  };
}
