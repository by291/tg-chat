// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { setAppearanceMode } from './appearanceStore';
import { useAppearanceTheme } from './useAppearanceTheme';

function ThemeRoot() {
  const { isDark } = useAppearanceTheme({ isReady: true, isLegacyDark: false });
  return <output>{isDark ? 'Dark' : 'Light'}</output>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'startViewTransition');
});

it('updates the document when system brightness changes without changing the selected mode', () => {
  const listeners = new Set<() => void>();
  let isSystemDark = false;
  vi.stubGlobal('matchMedia', () => ({
    matches: isSystemDark,
    addEventListener: (_event: string, notify: () => void) => listeners.add(notify),
    removeEventListener: (_event: string, notify: () => void) => listeners.delete(notify),
  }));
  setAppearanceMode('system');
  render(<ThemeRoot />);

  expect(document.documentElement.dataset.theme).toBe('light');

  act(() => {
    isSystemDark = true;
    for (const notify of listeners) {
      notify();
    }
  });

  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.style.getPropertyValue('--surface-color')).not.toBe('#ffffff');
});
