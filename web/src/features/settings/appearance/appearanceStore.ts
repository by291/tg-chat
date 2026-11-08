import { createPreferenceStore } from '@/lib/createPreferenceStore';
import { z } from 'zod';

export const APPEARANCE_KEY = 'react-tweb.appearance.v1';
// prettier-ignore
export const themeVariantSchema = z.enum([
  'classic',
  'night',
  'day',
  'dark',
]);
// prettier-ignore
const modeSchema = z.enum([
  'classic',
  'night',
  'day',
  'dark',
  'system',
]);
const colorSchema = z.string().regex(/^#[\da-f]{6}$/i);
const themeIdSchema = z.enum([
  'default',
  'diamond',
  'rose',
  'peach',
  'green',
  'lavender',
  'forest',
  'ocean',
  'sunset',
]);
const wallpaperSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('color'), color: colorSchema }),
  z.object({ kind: z.literal('gradient'), themeId: themeIdSchema }),
  z.object({
    kind: z.literal('image'),
    imageId: z.string().min(1),
    isBlurred: z.boolean(),
  }),
]);
const choiceSchema = z.object({
  themeId: themeIdSchema.catch('diamond'),
  accent: colorSchema.nullable().catch(null),
  wallpaper: wallpaperSchema.nullable().catch(null),
});
const choicesSchema = z.object({
  classic: choiceSchema.catch(() => choiceSchema.parse({})),
  night: choiceSchema.catch(() => choiceSchema.parse({})),
  day: choiceSchema.catch(() => choiceSchema.parse({ themeId: 'default' })),
  dark: choiceSchema.catch(() => choiceSchema.parse({ themeId: 'default' })),
});
const appearanceSchema = z.object({
  mode: modeSchema.catch('classic'),
  lastLight: z.enum(['classic', 'day']).catch('classic'),
  lastDark: z.enum(['night', 'dark']).catch('night'),
  choices: choicesSchema.catch(() => choicesSchema.parse({})),
});

export type ThemeVariant = z.infer<typeof themeVariantSchema>;
export type AppearanceMode = z.infer<typeof modeSchema>;
export type Wallpaper = z.infer<typeof wallpaperSchema>;
export type ThemeChoice = z.infer<typeof choiceSchema>;
export type Appearance = z.infer<typeof appearanceSchema>;

const preferenceStore = createPreferenceStore({
  storageKey: APPEARANCE_KEY,
  parse: (value) => appearanceSchema.parse(value),
});

/** Read the appearance snapshot shared by controls and document rendering. */
export const getAppearance = preferenceStore.getSnapshot;

/** Observe local changes and preferences saved by another tab. */
export const subscribeAppearance = preferenceStore.subscribe;

/** Subscribe to appearance fields or the complete theme and wallpaper snapshot. */
export const useAppearance = preferenceStore.useValue;

/** Select a mode while remembering explicit light and dark choices for the menu toggle. */
export function setAppearanceMode(mode: AppearanceMode) {
  const next = { ...getAppearance(), mode };
  if (mode === 'classic' || mode === 'day') {
    next.lastLight = mode;
  }
  if (mode === 'night' || mode === 'dark') {
    next.lastDark = mode;
  }

  return preferenceStore.save(next);
}

/** Change only the requested variant, preserving other modes and unrelated appearance fields. */
export function updateThemeChoice({
  variant,
  changes,
}: {
  variant: ThemeVariant;
  changes: Partial<ThemeChoice>;
}) {
  const appearance = getAppearance();
  return preferenceStore.save({
    ...appearance,
    choices: {
      ...appearance.choices,
      [variant]: { ...appearance.choices[variant], ...changes },
    },
  });
}

/** Resolve automatic mode through the user's last light and dark variants. */
export function resolveThemeVariant({
  mode,
  isSystemDark,
}: {
  mode: AppearanceMode;
  isSystemDark: boolean;
}): ThemeVariant {
  if (mode !== 'system') {
    return mode;
  }

  const appearance = getAppearance();

  return isSystemDark ? appearance.lastDark : appearance.lastLight;
}

/** Return the remembered opposite brightness for the sidebar's mode toggle. */
export function getOppositeMode({ isDark }: { isDark: boolean }) {
  const appearance = getAppearance();
  return isDark ? appearance.lastLight : appearance.lastDark;
}

/** Import the legacy chat preference once, after persisted chat state has loaded. */
export function migrateLegacyAppearance({ isDark }: { isDark: boolean }) {
  if (!preferenceStore.hasSavedValue()) {
    setAppearanceMode(isDark ? 'night' : 'classic');
  }
}
