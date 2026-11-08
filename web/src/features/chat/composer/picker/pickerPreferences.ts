import { useState } from 'react';
import { z } from 'zod';

const STORAGE_KEY = 'react-tweb.emoticons.v1';
const MAX_RECENT_EMOJI = 32;
const MAX_RECENT_STICKERS = 20;
const preferencesSchema = z.object({
  recentEmoji: z.array(z.string()).default([]),
  tones: z.record(z.string(), z.number().int().min(0).max(5)).default({}),
  recentStickers: z.array(z.string()).default([]),
  favoriteStickers: z.array(z.string()).default([]),
});
type PickerPreferences = z.infer<typeof preferencesSchema>;

function readPreferences(): PickerPreferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return preferencesSchema.parse(saved);
  } catch {
    return preferencesSchema.parse({});
  }
}

/** Persist local recents, per-emoji skin tones, and favorite sticker identifiers. */
export function usePickerPreferences() {
  const [preferences, setPreferences] = useState(readPreferences);

  function save(next: PickerPreferences) {
    setPreferences(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A full or blocked store must not prevent inserting an emoji or sending a sticker.
    }
  }

  function rememberEmoji(id: string) {
    const remaining = preferences.recentEmoji.filter((recentId) => recentId !== id);
    save({ ...preferences, recentEmoji: [id, ...remaining].slice(0, MAX_RECENT_EMOJI) });
  }

  function setTone(id: string, tone: number) {
    save({ ...preferences, tones: { ...preferences.tones, [id]: tone } });
  }

  function rememberSticker(id: string) {
    const remaining = preferences.recentStickers.filter((recentId) => recentId !== id);
    save({ ...preferences, recentStickers: [id, ...remaining].slice(0, MAX_RECENT_STICKERS) });
  }

  function toggleFavorite(id: string) {
    const isFavorite = preferences.favoriteStickers.includes(id);
    const favorites = isFavorite
      ? preferences.favoriteStickers.filter((stickerId) => stickerId !== id)
      : [...preferences.favoriteStickers, id];
    save({ ...preferences, favoriteStickers: favorites });
  }

  return {
    preferences,
    rememberEmoji,
    setTone,
    rememberSticker,
    toggleFavorite,
  };
}
