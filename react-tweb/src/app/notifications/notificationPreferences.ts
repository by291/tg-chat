import { createPreferenceStore } from '../settings/createPreferenceStore';
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

const preferenceStore = createPreferenceStore({
  storageKey: NOTIFICATION_PREFERENCES_KEY,
  parse: (value) => preferencesSchema.parse(value),
});

/** Read the notification preferences used by incoming and outgoing message delivery. */
export const getNotificationPreferences = preferenceStore.getSnapshot;

/** Observe local changes and updates made in another browser tab. */
export const subscribeNotificationPreferences = preferenceStore.subscribe;

/** Persist notification preferences without losing the current choice if storage is blocked. */
export function setNotificationPreferences(changes: Partial<NotificationPreferences>) {
  return preferenceStore.save({ ...getNotificationPreferences(), ...changes });
}

/** Subscribe to notification fields without observing unrelated preferences. */
export const useNotificationPreferences = preferenceStore.useValue;
