// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import {
  APP_PREFERENCES_KEY,
  DEFAULT_APP_PREFERENCES,
  getAppPreferences,
  setAppPreferences,
  useAppPreferences,
} from './appPreferences';

function PreferenceReader() {
  const preferences = useAppPreferences();
  return (
    <output>
      {preferences.messageTextSize} / {preferences.timeFormat}
    </output>
  );
}

afterEach(() => {
  cleanup();
  setAppPreferences(DEFAULT_APP_PREFERENCES);
  localStorage.clear();
});

it('persists changes and updates subscribed readers immediately', () => {
  render(<PreferenceReader />);
  act(() => setAppPreferences({ messageTextSize: 20, timeFormat: 'h23' }));

  expect(screen.getByText('20 / h23')).toBeTruthy();

  const saved = JSON.parse(localStorage.getItem(APP_PREFERENCES_KEY)!);

  expect(saved.messageTextSize).toBe(20);
  expect(saved.timeFormat).toBe('h23');
});

it('keeps time readers subscribed only to time-format changes', () => {
  const observedFormats: string[] = [];
  const view = renderHook(() => {
    const timeFormat = useAppPreferences((preferences) => preferences.timeFormat);
    observedFormats.push(timeFormat);
    return timeFormat;
  });

  act(() => setAppPreferences({ messageTextSize: 20 }));

  expect(observedFormats).toEqual(['h12']);

  act(() => setAppPreferences({ timeFormat: 'h23' }));

  expect(view.result.current).toBe('h23');
});

it('recovers invalid stored fields while preserving valid preferences from another tab', () => {
  render(<PreferenceReader />);
  localStorage.setItem(
    APP_PREFERENCES_KEY,
    JSON.stringify({
      messageTextSize: 99,
      timeFormat: 'h23',
      shouldAutoplayVideos: false,
      shouldUseLargeEmoji: false,
      shouldAutoplayStickersInPanel: false,
      stickerPackOrder: ['recent-pack'],
    }),
  );
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_PREFERENCES_KEY })));

  expect(screen.getByText('16 / h23')).toBeTruthy();
  expect(getAppPreferences().shouldAutoplayVideos).toBe(false);
  expect(getAppPreferences().shouldUseLargeEmoji).toBe(false);
  expect(getAppPreferences().shouldAutoplayStickersInPanel).toBe(false);
  expect(getAppPreferences().stickerPackOrder).toEqual(['recent-pack']);
});
