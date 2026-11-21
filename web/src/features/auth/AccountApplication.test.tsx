// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { setAppearanceMode } from '@/features/settings/appearance/appearanceStore';
import { AccountApplication } from './AccountApplication';

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

it('applies the connected system palette when the browser switches brightness', () => {
  let isDark = false;
  const events = new EventTarget();
  vi.stubGlobal('matchMedia', () => ({
    matches: isDark,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  }));
  vi.stubGlobal('fetch', async () => new Promise<Response>(() => undefined));
  setAppearanceMode('system');
  render(<AccountApplication />);
  expect(document.documentElement.dataset.theme).toBe('light');

  act(() => {
    isDark = true;
    events.dispatchEvent(new Event('change'));
  });
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.style.getPropertyValue('--surface-color')).toBeTruthy();
});
