import { useSyncExternalStore } from 'react';
import { z } from 'zod';

export const APP_PREFERENCES_KEY = 'react-tweb.preferences.v1';
export const MIN_MESSAGE_TEXT_SIZE = 12;
export const MAX_MESSAGE_TEXT_SIZE = 20;
export const DEFAULT_APP_PREFERENCES = {
  messageTextSize: 16,
  timeFormat: 'h12' as const,
  shouldAutoplayVideos: true,
  shouldAnimateStickers: true,
};

const messageTextSizeSchema = z.int().min(MIN_MESSAGE_TEXT_SIZE).max(MAX_MESSAGE_TEXT_SIZE);

const preferenceSchema = z.object({
  messageTextSize: messageTextSizeSchema.catch(DEFAULT_APP_PREFERENCES.messageTextSize),
  timeFormat: z.enum(['h12', 'h23']).catch(DEFAULT_APP_PREFERENCES.timeFormat),
  shouldAutoplayVideos: z.boolean().catch(DEFAULT_APP_PREFERENCES.shouldAutoplayVideos),
  shouldAnimateStickers: z.boolean().catch(DEFAULT_APP_PREFERENCES.shouldAnimateStickers),
});

export type AppPreferences = z.infer<typeof preferenceSchema>;

const listeners = new Set<() => void>();
let preferences = readPreferences();

function readPreferences(): AppPreferences {
  try {
    const stored = localStorage.getItem(APP_PREFERENCES_KEY);
    return preferenceSchema.parse(stored ? JSON.parse(stored) : {});
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
}

function notifyListeners() {
  for (const notify of listeners) {
    notify();
  }
}

function synchronizeStorage(event: StorageEvent) {
  if (event.key !== APP_PREFERENCES_KEY && event.key !== null) {
    return;
  }
  preferences = readPreferences();
  notifyListeners();
}

/** Read the stable preference snapshot shared by UI and media policies. */
export function getAppPreferences() {
  return preferences;
}

/** Observe local and cross-tab changes with one shared storage listener. */
export function subscribeAppPreferences(notify: () => void) {
  if (listeners.size === 0) {
    window.addEventListener('storage', synchronizeStorage);
  }
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
    if (listeners.size === 0) {
      window.removeEventListener('storage', synchronizeStorage);
    }
  };
}

/** Persist validated preferences while allowing changes when browser storage is unavailable. */
export function setAppPreferences(changes: Partial<AppPreferences>) {
  preferences = preferenceSchema.parse({ ...preferences, ...changes });
  try {
    localStorage.setItem(APP_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Private browsing and storage quotas must not block changes in the current session.
  }
  notifyListeners();
}

/** Subscribe a component to immediately applied application preferences. */
export function useAppPreferences() {
  return useSyncExternalStore(subscribeAppPreferences, getAppPreferences);
}
