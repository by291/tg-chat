import { createPreferenceStore } from '@/lib/preferences/createPreferenceStore';
import { z } from 'zod';

export const APP_PREFERENCES_KEY = 'react-tweb.preferences.v1';
export const MIN_MESSAGE_TEXT_SIZE = 12;
export const MAX_MESSAGE_TEXT_SIZE = 20;
export const DEFAULT_APP_PREFERENCES = {
  messageTextSize: 16,
  sendShortcut: 'enter' as const,
  timeFormat: 'h12' as const,
  shouldAutoplayVideos: true,
  shouldAnimateStickers: true,
  shouldAutoplayStickersInChat: true,
  shouldAutoplayStickersInPanel: true,
  shouldUseLargeEmoji: true,
  shouldUseDynamicPackOrder: true,
  stickerPackOrder: [] as string[],
};

const messageTextSizeSchema = z.int().min(MIN_MESSAGE_TEXT_SIZE).max(MAX_MESSAGE_TEXT_SIZE);

const preferenceSchema = z.object({
  messageTextSize: messageTextSizeSchema.catch(DEFAULT_APP_PREFERENCES.messageTextSize),
  sendShortcut: z.enum(['enter', 'ctrlEnter']).catch(DEFAULT_APP_PREFERENCES.sendShortcut),
  timeFormat: z.enum(['h12', 'h23']).catch(DEFAULT_APP_PREFERENCES.timeFormat),
  shouldAutoplayVideos: z.boolean().catch(DEFAULT_APP_PREFERENCES.shouldAutoplayVideos),
  shouldAnimateStickers: z.boolean().catch(DEFAULT_APP_PREFERENCES.shouldAnimateStickers),
  shouldAutoplayStickersInChat: z
    .boolean()
    .catch(DEFAULT_APP_PREFERENCES.shouldAutoplayStickersInChat),
  shouldAutoplayStickersInPanel: z
    .boolean()
    .catch(DEFAULT_APP_PREFERENCES.shouldAutoplayStickersInPanel),
  shouldUseLargeEmoji: z.boolean().catch(DEFAULT_APP_PREFERENCES.shouldUseLargeEmoji),
  shouldUseDynamicPackOrder: z.boolean().catch(DEFAULT_APP_PREFERENCES.shouldUseDynamicPackOrder),
  stickerPackOrder: z.array(z.string()).catch(DEFAULT_APP_PREFERENCES.stickerPackOrder),
});

export type AppPreferences = z.infer<typeof preferenceSchema>;

const preferenceStore = createPreferenceStore({
  storageKey: APP_PREFERENCES_KEY,
  parse: (value) => preferenceSchema.parse(value),
});

/** Read the stable preference snapshot shared by UI and media policies. */
export const getAppPreferences = preferenceStore.getSnapshot;

/** Observe local and cross-tab changes with one shared storage listener. */
export const subscribeAppPreferences = preferenceStore.subscribe;

/** Persist validated preferences while allowing changes when browser storage is unavailable. */
export function setAppPreferences(changes: Partial<AppPreferences>) {
  preferenceStore.save({ ...getAppPreferences(), ...changes });
}

/** Subscribe to a preference selector, or the complete snapshot for a settings form. */
export const useAppPreferences = preferenceStore.useValue;
