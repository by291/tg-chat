import {
  getAppearance,
  resolveThemeVariant,
  setAppearanceMode,
  updateThemeChoice,
  type AppearanceMode,
  type ThemeChoice,
  type ThemeVariant,
} from './appearanceStore';
import { acquireWallpaperImage } from './wallpaperImageResources';
import { runThemeTransition, type ThemeOrigin } from './useThemeTransition';
import { showToast } from '@/components/toastStore';

interface AppearanceChange {
  choice: ThemeChoice;
  apply: () => boolean;
  origin?: ThemeOrigin;
}

async function retainPreparedImage(imageId: string) {
  const resource = acquireWallpaperImage(imageId);

  try {
    await resource.ready;
    return resource.release;
  } catch (error) {
    resource.release();
    throw error;
  }
}

function applyAppearanceChange({ choice, apply, origin }: AppearanceChange) {
  const wallpaper = choice.wallpaper;
  const prepare =
    wallpaper?.kind === 'image' ? () => retainPreparedImage(wallpaper.imageId) : undefined;

  return runThemeTransition({
    isDark: document.documentElement.dataset.theme === 'dark',
    origin,
    prepare,
    apply: () => {
      if (!apply()) {
        showToast('Appearance changed, but could not be saved on this device.');
      }
    },
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Could not prepare this appearance.';
    showToast(message);
  });
}

/** Fade a settings mode selection, or reveal it from an explicit menu-toggle origin. */
export function selectAppearanceMode(mode: AppearanceMode, origin?: ThemeOrigin) {
  const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const variant = resolveThemeVariant({ mode, isSystemDark });

  return applyAppearanceChange({
    choice: getAppearance().choices[variant],
    apply: () => setAppearanceMode(mode),
    origin,
  });
}

/** Apply palette and wallpaper choices through the same prepared document transition. */
export function selectThemeChoice({
  variant,
  changes,
}: {
  variant: ThemeVariant;
  changes: Partial<ThemeChoice>;
}) {
  return applyAppearanceChange({
    choice: { ...getAppearance().choices[variant], ...changes },
    apply: () => updateThemeChoice({ variant, changes }),
  });
}
