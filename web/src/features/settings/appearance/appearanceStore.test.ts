// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.restoreAllMocks();
});

it('preserves each mode selection and restores it after reload', async () => {
  const appearance = await import('./appearanceStore');
  appearance.setAppearanceMode('classic');
  appearance.updateThemeChoice({ variant: 'classic', changes: { themeId: 'rose' } });
  appearance.setAppearanceMode('night');
  appearance.updateThemeChoice({
    variant: 'night',
    changes: { wallpaper: { kind: 'color', color: '#123456' } },
  });
  vi.resetModules();
  const restored = await import('./appearanceStore');

  expect(restored.getAppearance().mode).toBe('night');
  expect(restored.getAppearance().choices.classic.themeId).toBe('rose');
  expect(restored.getAppearance().choices.night.wallpaper).toEqual({
    kind: 'color',
    color: '#123456',
  });
});

it('resolves system mode and toggles back to the last chosen opposite variant', async () => {
  const appearance = await import('./appearanceStore');
  appearance.setAppearanceMode('day');
  appearance.setAppearanceMode('dark');

  expect(appearance.getOppositeMode({ isDark: true })).toBe('day');

  appearance.setAppearanceMode('system');

  expect(appearance.resolveThemeVariant({ mode: 'system', isSystemDark: true })).toBe('dark');
  expect(appearance.resolveThemeVariant({ mode: 'system', isSystemDark: false })).toBe('day');
});

it('recovers malformed choices without discarding valid modes', async () => {
  const appearance = await import('./appearanceStore');
  localStorage.setItem(
    appearance.APPEARANCE_KEY,
    JSON.stringify({
      mode: 'night',
      choices: {
        classic: { themeId: 'missing', wallpaper: { kind: 'color', color: 'broken' } },
        night: { themeId: 'rose' },
      },
    }),
  );
  vi.resetModules();
  const restored = await import('./appearanceStore');

  expect(restored.getAppearance().mode).toBe('night');
  expect(restored.getAppearance().choices.night.themeId).toBe('rose');
  expect(restored.getAppearance().choices.classic.wallpaper).toBeNull();
});

it('keeps the current session usable when persistence is unavailable', async () => {
  const appearance = await import('./appearanceStore');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });

  expect(appearance.setAppearanceMode('night')).toBe(false);
  expect(appearance.getAppearance().mode).toBe('night');
});

it('migrates the old dark preference only before appearance has been chosen', async () => {
  const appearance = await import('./appearanceStore');
  appearance.migrateLegacyAppearance({ isDark: true });

  expect(appearance.getAppearance().mode).toBe('night');

  appearance.setAppearanceMode('day');
  appearance.migrateLegacyAppearance({ isDark: true });

  expect(appearance.getAppearance().mode).toBe('day');
});
