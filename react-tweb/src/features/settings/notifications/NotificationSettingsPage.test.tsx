// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
