// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SettingsPage } from './SettingsPage';

vi.mock('./appearance/ThemeEmoji', () => ({ ThemeEmoji: () => null }));

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
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
  localStorage.clear();
  vi.unstubAllGlobals();
});

function renderSettings() {
  const onBack = vi.fn();
  render(
    <MemoryRouter initialEntries={['/?settings=overview']}>
      <SettingsPage
        conversations={[]}
        onSetMuted={() => {}}
        onResetMutes={() => {}}
        onBack={onBack}
      />
    </MemoryRouter>,
  );
  return onBack;
}

it('preserves the query after visiting a result and remembers it on the next search', async () => {
  const user = userEvent.setup();
  renderSettings();
  await user.click(screen.getByRole('button', { name: 'Search settings' }));
  const input = screen.getByRole('textbox', { name: 'Search settings' });
  await user.type(input, 'sound volume');
  await user.click(screen.getByRole('button', { name: 'Sound Volume Notifications' }));
  expect(screen.getByRole('slider', { name: 'Sound Volume' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Back from notifications' }));
  expect((screen.getByRole('textbox', { name: 'Search settings' }) as HTMLInputElement).value).toBe(
    'sound volume',
  );
  await user.click(screen.getByRole('button', { name: 'Back from settings search' }));
  await user.click(screen.getByRole('button', { name: 'Search settings' }));
  const recent = await screen.findByRole('region', { name: 'Recent settings' });
  expect(within(recent).getByRole('button', { name: 'Sound Volume Notifications' })).toBeTruthy();
});

it('clears the query before closing search and keeps Escape inside settings', async () => {
  const user = userEvent.setup();
  const onBack = renderSettings();
  await user.click(screen.getByRole('button', { name: 'Search settings' }));
  await user.type(screen.getByRole('textbox', { name: 'Search settings' }), 'not-found');
  expect(screen.getByRole('status').textContent).toBe('No results');
  await user.click(screen.getByRole('button', { name: 'Clear settings search' }));
  expect(screen.getByRole('textbox', { name: 'Search settings' })).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Search settings' })).toBeTruthy();
  expect(onBack).not.toHaveBeenCalled();
});

it('opens the nested power page directly and preserves the profile cover after search', async () => {
  const user = userEvent.setup();
  renderSettings();
  fireEvent.load(screen.getByAltText('Your profile photo'));
  await user.click(screen.getByRole('button', { name: 'Expand profile photo' }));
  await user.click(screen.getByRole('button', { name: 'Search settings' }));
  await user.type(screen.getByRole('textbox', { name: 'Search settings' }), 'battery');
  await user.click(
    screen.getByRole('button', { name: 'Power Saving General Settings › Power Saving' }),
  );
  expect(screen.getByRole('checkbox', { name: 'Autoplay Videos' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Back from power saving' }));
  await user.click(screen.getByRole('button', { name: 'Back from general settings' }));
  await user.click(screen.getByRole('button', { name: 'Back from settings search' }));
  expect(
    screen.getByRole('button', { name: 'Expand profile photo' }).getAttribute('aria-expanded'),
  ).toBe('true');
});

it('labels account actions as unavailable and dismisses their menu without leaving settings', async () => {
  const user = userEvent.setup();
  const onBack = renderSettings();
  await user.click(screen.getByRole('button', { name: 'More settings' }));
  const edit = await screen.findByRole('menuitem', { name: 'Edit Profile' });
  expect(edit.getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByRole('menuitem', { name: 'QR Code' }).getAttribute('aria-disabled')).toBe(
    'true',
  );
  expect(screen.getByRole('menuitem', { name: 'Log Out' }).getAttribute('aria-disabled')).toBe(
    'true',
  );
  expect(screen.getByText('Requires account backend')).toBeTruthy();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(onBack).not.toHaveBeenCalled();
});
