// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WallpaperSettingsPage } from './WallpaperSettingsPage';
import { getAppearance, setAppearanceMode, updateThemeChoice } from './appearanceStore';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  setAppearanceMode('classic');
  updateThemeChoice({ variant: 'classic', changes: { themeId: 'diamond', wallpaper: null } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('changes the background independently and resets to the selected theme', () => {
  render(<WallpaperSettingsPage onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rose wallpaper' }));

  expect(getAppearance().choices.classic.themeId).toBe('diamond');
  expect(getAppearance().choices.classic.wallpaper).toEqual({ kind: 'gradient', themeId: 'rose' });

  fireEvent.click(screen.getByRole('button', { name: 'Reset to Defaults' }));

  expect(getAppearance().choices.classic.wallpaper).toBeNull();
});

it('applies a solid color and closes only the color page on Escape', () => {
  const onBack = vi.fn();
  render(<WallpaperSettingsPage onBack={onBack} />);
  fireEvent.click(screen.getByRole('button', { name: 'Set a color' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use #b2cee1' }));

  expect(getAppearance().choices.classic.wallpaper).toEqual({ kind: 'color', color: '#b2cee1' });

  fireEvent.keyDown(screen.getByRole('button', { name: 'Back from wallpaper color' }), {
    key: 'Escape',
  });

  expect(onBack).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Chat Wallpaper' })).toBeTruthy();
});
