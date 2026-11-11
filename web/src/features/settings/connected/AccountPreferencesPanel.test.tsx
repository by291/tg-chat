// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { components } from '@/api/schema';
import { getAppPreferences, setAppPreferences } from '../appPreferences';
import {
  getNotificationPreferences,
  setNotificationPreferences,
} from '../notifications/notificationPreferences';
import { AccountPreferencesPanel } from './AccountPreferencesPanel';

const preferences: components['schemas']['AccountPreferences'] = {
  version: '9007199254740993',
  sticker_pack_ids: ['UtyaDuck', 'Crocosaurus'],
  notification_defaults: {
    should_show_notifications: true,
    should_show_offline_notifications: false,
    should_play_sound: true,
    should_play_sent_sound: true,
    volume: 50,
    private: { should_notify: true, should_show_preview: true },
    group: { should_notify: true, should_show_preview: true },
    channel: { should_notify: true, should_show_preview: true },
  },
};

afterEach(cleanup);

it('saves selected sticker order without changing device-local sticker preferences', async () => {
  setAppPreferences({
    shouldUseDynamicPackOrder: false,
    stickerPackOrder: ['shark_animated'],
  });
  const user = userEvent.setup();
  const update = vi.fn().mockResolvedValue(undefined);
  render(<AccountPreferencesPanel preferences={preferences} onUpdate={update} />);

  const stickers = screen.getByRole('region', { name: 'Sticker packs' });
  await user.click(within(stickers).getByRole('button', { name: 'Move Duck down' }));
  await user.click(within(stickers).getByRole('checkbox', { name: /Shark Animated/ }));
  await user.click(within(stickers).getByRole('button', { name: 'Save sticker packs' }));

  expect(update).toHaveBeenCalledWith({
    expected_version: '9007199254740993',
    // prettier-ignore
    sticker_pack_ids: [
      'Crocosaurus',
      'UtyaDuck',
      'shark_animated',
    ],
  });
  expect(getAppPreferences().stickerPackOrder).toEqual(['shark_animated']);
  expect(getAppPreferences().shouldUseDynamicPackOrder).toBe(false);
});

it('saves notification defaults independently of the device notification store', async () => {
  setNotificationPreferences({ volume: 25, shouldShowNotifications: true });
  const user = userEvent.setup();
  const update = vi.fn().mockResolvedValue(undefined);
  render(<AccountPreferencesPanel preferences={preferences} onUpdate={update} />);

  await user.click(screen.getByRole('checkbox', { name: 'In-app alerts' }));
  const volume = screen.getByRole('spinbutton', { name: 'Notification volume' });
  await user.clear(volume);
  await user.type(volume, '70');
  await user.click(screen.getByRole('button', { name: 'Save notification defaults' }));

  expect(update).toHaveBeenCalledWith({
    expected_version: '9007199254740993',
    notification_defaults: {
      ...preferences.notification_defaults,
      should_show_notifications: false,
      volume: 70,
    },
  });
  expect(getNotificationPreferences().shouldShowNotifications).toBe(true);
  expect(getNotificationPreferences().volume).toBe(25);
});
