// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  APP_PREFERENCES_KEY,
  DEFAULT_APP_PREFERENCES,
  getAppPreferences,
  setAppPreferences,
} from '../appPreferences';
import { KeyboardSettingsPage } from './KeyboardSettingsPage';

beforeEach(() => {
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
  setAppPreferences(DEFAULT_APP_PREFERENCES);
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('persists the send shortcut and updates the corresponding newline combination', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh');
  const user = userEvent.setup();
  render(<KeyboardSettingsPage onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Send message shortcut' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Command + Enter' }));
  expect(getAppPreferences().sendShortcut).toBe('ctrlEnter');
  const saved = JSON.parse(localStorage.getItem(APP_PREFERENCES_KEY)!);
  expect(saved.sendShortcut).toBe('ctrlEnter');
  const messages = screen.getByRole('region', { name: 'Messages' });
  const newline = within(messages).getByText('New line').closest('[data-unavailable], div');
  expect(newline?.textContent).toContain('↵');
  expect(newline?.textContent).not.toContain('⇧');

  await user.click(screen.getByRole('button', { name: 'Send message shortcut' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Enter' }));
  expect(getAppPreferences().sendShortcut).toBe('enter');
  expect(newline?.textContent).toContain('⇧');
});
