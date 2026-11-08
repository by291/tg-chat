import { useSyncExternalStore } from 'react';
import { z } from 'zod';

export const NOTIFICATION_PREFERENCES_KEY = 'react-tweb.notifications.v1';
export const DEFAULT_NOTIFICATION_VOLUME = 50;
export const DEFAULT_NOTIFICATION_PREFERENCES = {
  shouldShowNotifications: true,
  shouldShowOfflineNotifications: true,
  shouldPlaySound: true,
  shouldPlaySentSound: true,
  volume: DEFAULT_NOTIFICATION_VOLUME,
  private: { shouldNotify: true, shouldShowPreview: true },
  group: { shouldNotify: true, shouldShowPreview: true },
  channel: { shouldNotify: true, shouldShowPreview: true },
};

const categorySchema = z.object({
  shouldNotify: z.boolean().catch(true),
  shouldShowPreview: z.boolean().catch(true),
});
const preferencesSchema = z.object({
  shouldShowNotifications: z.boolean().catch(true),
  shouldShowOfflineNotifications: z.boolean().catch(true),
  shouldPlaySound: z.boolean().catch(true),
  shouldPlaySentSound: z.boolean().catch(true),
  volume: z.number().min(0).max(100).catch(DEFAULT_NOTIFICATION_VOLUME),
  private: categorySchema.catch(DEFAULT_NOTIFICATION_PREFERENCES.private),
  group: categorySchema.catch(DEFAULT_NOTIFICATION_PREFERENCES.group),
  channel: categorySchema.catch(DEFAULT_NOTIFICATION_PREFERENCES.channel),
});

export type NotificationPreferences = z.infer<typeof preferencesSchema>;
export type NotificationCategory = 'private' | 'group' | 'channel';

const listeners = new Set<() => void>();
let preferences = readPreferences();

function readPreferences(): NotificationPreferences {
  try {
    const saved = localStorage.getItem(NOTIFICATION_PREFERENCES_KEY);
    return preferencesSchema.parse(saved ? JSON.parse(saved) : {});
  } catch {
    return structuredClone(DEFAULT_NOTIFICATION_PREFERENCES);
  }
}

function publishChanges() {
  for (const listener of listeners) {
    listener();
  }
}

function onStorage(event: StorageEvent) {
  if (event.key !== NOTIFICATION_PREFERENCES_KEY && event.key !== null) {
    return;
  }
  preferences = readPreferences();
  publishChanges();
}

/** Read the notification preferences used by incoming and outgoing message delivery. */
export function getNotificationPreferences() {
  return preferences;
}

/** Observe local changes and updates made in another browser tab. */
export function subscribeNotificationPreferences(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener('storage', onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('storage', onStorage);
    }
  };
}

/** Persist notification preferences without losing the current choice if storage is blocked. */
export function setNotificationPreferences(changes: Partial<NotificationPreferences>) {
  preferences = preferencesSchema.parse({ ...preferences, ...changes });
  let isSaved = true;
  try {
    localStorage.setItem(NOTIFICATION_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    isSaved = false;
  }
  publishChanges();
  return isSaved;
}

/** Subscribe settings and delivery to the same notification preference snapshot. */
export function useNotificationPreferences() {
  return useSyncExternalStore(subscribeNotificationPreferences, getNotificationPreferences);
}
