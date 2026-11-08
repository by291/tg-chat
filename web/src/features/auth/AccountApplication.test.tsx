// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
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
