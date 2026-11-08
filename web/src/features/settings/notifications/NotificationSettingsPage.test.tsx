// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getToastSnapshot } from '@/components/toastStore';
import { NotificationSettingsPage } from './NotificationSettingsPage';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferences,
  setNotificationPreferences,
} from './notificationPreferences';

const requestPermission = vi.fn();

beforeEach(() => {
  setNotificationPreferences(structuredClone(DEFAULT_NOTIFICATION_PREFERENCES));
  requestPermission.mockReset();
  vi.stubGlobal('Notification', { permission: 'default', requestPermission });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderSettings() {
  render(
    <NotificationSettingsPage
      conversations={[]}
      onSetMuted={() => {}}
      onResetMutes={() => {}}
      onBack={() => {}}
    />,
  );
}

it('requests permission only from the enable action and keeps a denial disabled', async () => {
  requestPermission.mockResolvedValue('denied');
  renderSettings();

  expect(requestPermission).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Enable Notifications' }));
  await waitFor(() =>
    expect(
      screen.getByRole('checkbox', { name: 'Show notifications' }).hasAttribute('disabled'),
    ).toBe(true),
  );

  expect(requestPermission).toHaveBeenCalledTimes(1);
});

it('turns sound off at zero volume and restores an audible level when enabled', async () => {
  renderSettings();
  fireEvent.change(screen.getByRole('slider', { name: 'Sound Volume' }), {
    target: { value: '0' },
  });

  expect(getNotificationPreferences().shouldPlaySound).toBe(false);

  fireEvent.click(screen.getByRole('checkbox', { name: 'Notification Sound' }));
  await waitFor(() => expect(getNotificationPreferences().shouldPlaySound).toBe(true));

  expect(getNotificationPreferences().volume).toBeGreaterThan(0);
});

it('keeps the reset active and reports unsaved preferences when storage fails', async () => {
  setNotificationPreferences({ shouldPlaySound: false, volume: 10 });
  renderSettings();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage is unavailable');
  });

  fireEvent.click(screen.getByRole('button', { name: 'Reset All Notifications' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));

  expect(getNotificationPreferences()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  expect(getToastSnapshot()?.message).toMatch(/could not be saved/i);

  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
});

it('reports a successful reset after storing the restored defaults', async () => {
  setNotificationPreferences({ shouldPlaySound: false, volume: 10 });
  renderSettings();

  fireEvent.click(screen.getByRole('button', { name: 'Reset All Notifications' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));

  expect(getNotificationPreferences()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  expect(getToastSnapshot()?.message).toMatch(/settings reset/i);
  expect(getToastSnapshot()?.message).not.toMatch(/could not/i);
});
