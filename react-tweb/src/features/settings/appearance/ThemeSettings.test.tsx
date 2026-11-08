// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeSettings } from './ThemeSettings';
import { getAppearance, setAppearanceMode, updateThemeChoice } from './appearanceStore';

vi.mock('@/features/stickers/loadStickerAnimation', () => ({
  loadStickerAnimation: () => new Promise(() => {}),
}));

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

it('applies a theme and clears only the active wallpaper override', () => {
  updateThemeChoice({
    variant: 'classic',
    changes: { wallpaper: { kind: 'color', color: '#123456' } },
  });
  render(<ThemeSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Rose theme' }));
  expect(getAppearance().choices.classic.themeId).toBe('rose');
  expect(getAppearance().choices.classic.wallpaper).toBeNull();
  expect(screen.getByRole('button', { name: 'Rose theme' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
});

it('changes mode and exposes accent colors only in Dark', () => {
  render(<ThemeSettings />);
  fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
  expect(getAppearance().mode).toBe('dark');
  fireEvent.click(screen.getByRole('button', { name: 'Orange accent' }));
  expect(getAppearance().choices.dark.accent).toBe('#f08200');
  fireEvent.click(screen.getByRole('radio', { name: 'Classic' }));
  expect(screen.queryByRole('button', { name: 'Orange accent' })).toBeNull();
});

it('moves keyboard focus without smooth scrolling when reduced motion becomes enabled', () => {
  let shouldReduceMotion = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduced-motion') && shouldReduceMotion,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  render(<ThemeSettings />);
  const toolbar = screen.getByRole('toolbar', { name: 'Themes' });
  const scrollTo = vi.fn();
  toolbar.scrollTo = scrollTo;
  screen.getByRole('button', { name: 'Rose theme' }).focus();

  fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
  expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  shouldReduceMotion = true;
  fireEvent.keyDown(toolbar, { key: 'Home' });

  expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'instant' }));
  expect(document.activeElement).toBe(toolbar.querySelector('button'));
});
