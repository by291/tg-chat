import { useSyncExternalStore } from 'react';
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

const listeners = new Set<() => void>();
let hasSavedAppearance = false;
let appearance = readAppearance();

function readAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(APPEARANCE_KEY);
    hasSavedAppearance = stored !== null;
    return appearanceSchema.parse(stored ? JSON.parse(stored) : {});
  } catch {
    return appearanceSchema.parse({});
  }
}

function notifyListeners() {
  for (const notify of listeners) {
    notify();
  }
}

function persist(next: Appearance) {
  appearance = appearanceSchema.parse(next);
  hasSavedAppearance = true;
  let isSaved = true;
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
  } catch {
    // Storage failure must not prevent an in-session appearance change.
    isSaved = false;
  }
  notifyListeners();
  return isSaved;
}

function synchronizeStorage(event: StorageEvent) {
  if (event.key !== APPEARANCE_KEY && event.key !== null) {
    return;
  }
  appearance = readAppearance();
  notifyListeners();
}

/** Read the appearance snapshot shared by controls and document rendering. */
export function getAppearance() {
  return appearance;
}

/** Observe local changes and preferences saved by another tab. */
export function subscribeAppearance(notify: () => void) {
  if (listeners.size === 0) {
    window.addEventListener('storage', synchronizeStorage);
  }
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
    if (listeners.size === 0) {
      window.removeEventListener('storage', synchronizeStorage);
    }
  };
}

/** Subscribe a React control to persisted theme and wallpaper choices. */
export function useAppearance() {
  return useSyncExternalStore(subscribeAppearance, getAppearance);
}

/** Select a mode while remembering explicit light and dark choices for the menu toggle. */
export function setAppearanceMode(mode: AppearanceMode) {
  const next = { ...appearance, mode };
  if (mode === 'classic' || mode === 'day') {
    next.lastLight = mode;
  }
  if (mode === 'night' || mode === 'dark') {
    next.lastDark = mode;
  }
  return persist(next);
}

/** Change only the requested variant, preserving other modes and unrelated appearance fields. */
export function updateThemeChoice({
  variant,
  changes,
}: {
  variant: ThemeVariant;
  changes: Partial<ThemeChoice>;
}) {
  return persist({
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
  return isSystemDark ? appearance.lastDark : appearance.lastLight;
}

/** Return the remembered opposite brightness for the sidebar's mode toggle. */
export function getOppositeMode({ isDark }: { isDark: boolean }) {
  return isDark ? appearance.lastLight : appearance.lastDark;
}

/** Import the legacy chat preference once, after persisted chat state has loaded. */
export function migrateLegacyAppearance({ isDark }: { isDark: boolean }) {
  if (!hasSavedAppearance) {
    setAppearanceMode(isDark ? 'night' : 'classic');
  }
}
