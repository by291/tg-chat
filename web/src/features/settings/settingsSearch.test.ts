// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  readRecentSettings,
  RECENT_SETTINGS_KEY,
  rememberSetting,
  searchSettings,
} from './settingsSearch';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('finds nested controls using their title, path, and synonyms', () => {
  const volume = searchSettings('sound volume')[0];

  expect(volume.title).toBe('Sound Volume');
  expect(volume.category).toBe('notifications');
  expect(searchSettings('battery')[0]).toMatchObject({ category: 'general', page: 'power' });

  const preview = searchSettings('groups preview');

  expect(preview).toHaveLength(1);
  expect(preview[0]).toMatchObject({ title: 'Message Preview', scope: 'Groups' });
  expect(searchSettings('sound').some((item) => item.title === 'Message Preview')).toBe(false);
  expect(searchSettings('  ')).toEqual([]);
  expect(searchSettings('unmatchable-setting')).toEqual([]);
});

it('deduplicates recent picks and ignores corrupt or obsolete saved identifiers', () => {
  const volume = searchSettings('sound volume')[0];
  const wallpaper = searchSettings('chat wallpaper').find((item) => item.page === 'wallpaper')!;
  rememberSetting(volume.id);
  rememberSetting(wallpaper.id);
  rememberSetting(volume.id);

  expect(readRecentSettings()).toEqual([volume.id, wallpaper.id]);

  // prettier-ignore
  const savedIdentifiers = [
    volume.id,
    'obsolete',
    42,
  ];
  localStorage.setItem(RECENT_SETTINGS_KEY, JSON.stringify(savedIdentifiers));

  expect(readRecentSettings()).toEqual([volume.id]);

  localStorage.setItem(RECENT_SETTINGS_KEY, 'invalid');

  expect(readRecentSettings()).toEqual([]);
});

it('keeps navigation usable when recent history cannot be stored', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });

  expect(() => rememberSetting(searchSettings('volume')[0].id)).not.toThrow();
});
