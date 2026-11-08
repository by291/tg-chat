// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferences,
  NOTIFICATION_PREFERENCES_KEY,
  setNotificationPreferences,
  subscribeNotificationPreferences,
} from './notificationPreferences';

afterEach(() => {
  setNotificationPreferences(structuredClone(DEFAULT_NOTIFICATION_PREFERENCES));
});

it('persists preferences and applies changes from another tab', () => {
  const unsubscribe = subscribeNotificationPreferences(() => {});
  try {
    setNotificationPreferences({ shouldPlaySound: false, volume: 25 });
    const saved = JSON.parse(localStorage.getItem(NOTIFICATION_PREFERENCES_KEY)!);

    expect(saved.shouldPlaySound).toBe(false);
    expect(saved.volume).toBe(25);

    localStorage.setItem(NOTIFICATION_PREFERENCES_KEY, JSON.stringify({ ...saved, volume: 75 }));
    window.dispatchEvent(new StorageEvent('storage', { key: NOTIFICATION_PREFERENCES_KEY }));

    expect(getNotificationPreferences().volume).toBe(75);
  } finally {
    unsubscribe();
  }
});

it('recovers safely from malformed preferences received from another tab', () => {
  const unsubscribe = subscribeNotificationPreferences(() => {});
  try {
    localStorage.setItem(NOTIFICATION_PREFERENCES_KEY, '{invalid');
    window.dispatchEvent(new StorageEvent('storage', { key: NOTIFICATION_PREFERENCES_KEY }));

    expect(getNotificationPreferences()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  } finally {
    unsubscribe();
  }
});
