// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsAccountDetails } from './SettingsAccountDetails';
import { ToastViewport } from '@/components/Toast';
import { hideToast } from '@/components/toastStore';

const profile = {
  email: 'alex@example.com',
  username: 'alex_demo',
};

beforeEach(() => {
  render(<ToastViewport />);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  hideToast();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('copies the email exactly and prefixes the copied username with an at sign', async () => {
  const user = userEvent.setup();
  render(<SettingsAccountDetails profile={profile} />);

  await user.click(screen.getByRole('button', { name: 'alex@example.com Email' }));
  expect(await navigator.clipboard.readText()).toBe('alex@example.com');
  expect(screen.getByRole('status').textContent).toBe('Email copied to clipboard');

  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'alex_demo Username' }));
  expect(await navigator.clipboard.readText()).toBe('@alex_demo');
  expect(screen.getByRole('status').textContent).toBe('Username copied to clipboard');
});

it('copies from the context menu and keeps failures visible', async () => {
  const user = userEvent.setup();
  render(<SettingsAccountDetails profile={profile} />);
  fireEvent.contextMenu(screen.getByRole('button', { name: 'alex@example.com Email' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Copy Email' }));
  expect(await navigator.clipboard.readText()).toBe('alex@example.com');

  await user.keyboard('{Escape}');
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard unavailable'));
  await user.click(screen.getByRole('button', { name: 'alex_demo Username' }));
  expect(screen.getByRole('status').textContent).toBe('Could not copy username');
});
