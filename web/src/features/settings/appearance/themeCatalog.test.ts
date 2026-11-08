import { expect, it } from 'vitest';
import { getThemePalette, getWallpaperAppearance } from './themeCatalog';
import type { ThemeChoice } from './appearanceStore';

it('honors an explicit wallpaper independently of the Dark accent', () => {
  const choice: ThemeChoice = {
    themeId: 'default',
    accent: '#f08200',
    wallpaper: { kind: 'gradient', themeId: 'rose' },
  };
  const rose = getWallpaperAppearance({ variant: 'dark', choice });
  const ocean = getWallpaperAppearance({
    variant: 'dark',
    choice: { ...choice, wallpaper: { kind: 'gradient', themeId: 'ocean' } },
  });

  expect(rose.colors).not.toEqual(ocean.colors);
  expect(getThemePalette({ variant: 'dark', choice }).accent).toBe('#f08200');
});
