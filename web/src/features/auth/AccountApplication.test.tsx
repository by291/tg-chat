// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  APPEARANCE_KEY,
  setAppearanceMode,
  migrateLegacyAppearance,
} from '@/features/settings/appearance/appearanceStore';
import { AccountApplication } from './AccountApplication';

vi.hoisted(() => vi.stubEnv('VITE_APP_MODE', 'connected'));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.getElementById('startup-frame')?.remove();
});

it('reveals the account loading screen instead of leaving the chat startup cover over it', () => {
  vi.stubGlobal('fetch', async () => new Promise<Response>(() => undefined));
  const cover = document.createElement('div');
  cover.id = 'startup-frame';
  document.body.append(cover);
  render(<AccountApplication />);

  expect(screen.getByRole('status').textContent).toBe('Connecting to your account…');
  expect(cover.isConnected).toBe(false);
});

it('follows system brightness before any choice and leaves demo migration available', () => {
  let isDark = true;
  const events = new EventTarget();
  vi.stubGlobal('matchMedia', () => ({
    matches: isDark,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  }));
  vi.stubGlobal('fetch', async () => new Promise<Response>(() => undefined));
  expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull();
  const view = render(<AccountApplication />);
  expect(document.documentElement.dataset.theme).toBe('dark');

  act(() => {
    isDark = false;
    events.dispatchEvent(new Event('change'));
  });
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(document.documentElement.style.getPropertyValue('--surface-color')).toBeTruthy();
  view.unmount();
  expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull();

  migrateLegacyAppearance({ isDark: true });
  expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!).mode).toBe('night');
});

it('keeps an explicitly saved Classic palette on a dark system', () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal('fetch', async () => new Promise<Response>(() => undefined));
  setAppearanceMode('classic');
  render(<AccountApplication />);
  expect(document.documentElement.dataset.themeVariant).toBe('classic');
});
