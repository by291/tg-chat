import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import {
  getOppositeMode,
  migrateLegacyAppearance,
  resolveThemeVariant,
  useAppearance,
} from './appearanceStore';
import { getThemePalette } from './themeCatalog';
import type { ThemeOrigin } from './useThemeTransition';
import { selectAppearanceMode } from './appearanceActions';

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeSystemTheme(notify: () => void) {
  const query = window.matchMedia(SYSTEM_DARK_QUERY);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}

function getSystemTheme() {
  return window.matchMedia?.(SYSTEM_DARK_QUERY).matches ?? false;
}

/** Resolve the active variant reactively, including changes to system appearance. */
export function useResolvedAppearance() {
  const appearance = useAppearance();
  const isSystemDark = useSyncExternalStore(subscribeSystemTheme, getSystemTheme);
  const variant = resolveThemeVariant({ mode: appearance.mode, isSystemDark });
  return {
    appearance,
    variant,
    choice: appearance.choices[variant],
  };
}

/** Own the document palette and migrate the old dark preference after chat hydration. */
export function useAppearanceTheme({
  isReady,
  isLegacyDark,
}: {
  isReady: boolean;
  isLegacyDark: boolean;
}) {
  const resolved = useResolvedAppearance();
  const palette = useMemo(() => getThemePalette(resolved), [resolved.variant, resolved.choice]);
  useLayoutEffect(() => {
    if (isReady) {
      migrateLegacyAppearance({ isDark: isLegacyDark });
    }
  }, [isReady, isLegacyDark]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = palette.isDark ? 'dark' : 'light';
    root.dataset.themeVariant = resolved.variant;
    for (const [property, value] of Object.entries(palette.variables)) {
      root.style.setProperty(property, value);
    }
  }, [palette, resolved.variant]);

  function toggleTheme(origin?: ThemeOrigin) {
    selectAppearanceMode(getOppositeMode({ isDark: palette.isDark }), origin);
  }
  return {
    ...resolved,
    isDark: palette.isDark,
    toggleTheme,
  };
}
