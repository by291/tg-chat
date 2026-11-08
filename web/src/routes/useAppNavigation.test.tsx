// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { afterEach, expect, it } from 'vitest';
import { useAppNavigation } from './useAppNavigation';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

it('preserves unrelated parameters and returns to the previous chat through browser history', async () => {
  window.history.replaceState(null, '', '/?chat=alex&campaign=demo');
  const view = renderHook(useAppNavigation, { wrapper: BrowserRouter });

  expect(view.result.current.chatId).toBe('alex');

  act(() => view.result.current.openChat('design'));

  expect(view.result.current.chatId).toBe('design');
  expect(new URLSearchParams(window.location.search).get('campaign')).toBe('demo');

  act(() => window.history.back());

  await waitFor(() => expect(view.result.current.chatId).toBe('alex'));

  act(() => window.history.forward());

  await waitFor(() => expect(view.result.current.chatId).toBe('design'));
});

it('does not add history when selecting the current chat again', () => {
  window.history.replaceState(null, '', '/?chat=alex');
  const view = renderHook(useAppNavigation, { wrapper: BrowserRouter });
  const historyLength = window.history.length;
  act(() => view.result.current.openChat('alex'));

  expect(window.history.length).toBe(historyLength);
});

it('closes the chat without removing an open settings destination', () => {
  window.history.replaceState(null, '', '/?chat=alex&settings=notifications');
  const view = renderHook(useAppNavigation, { wrapper: BrowserRouter });
  act(() => view.result.current.closeChat());

  expect(view.result.current.chatId).toBe('');
  expect(view.result.current.settingsDestination?.category).toBe('notifications');
});

it('restores a nested settings page from its URL and returns one level at a time', () => {
  window.history.replaceState(null, '', '/?settings=general&settingsPage=power&chat=alex');
  const view = renderHook(useAppNavigation, { wrapper: BrowserRouter });

  expect(view.result.current.isSettingsOpen).toBe(true);
  expect(view.result.current.settingsDestination?.category).toBe('general');
  expect(view.result.current.settingsPage).toBe('power');

  act(() => view.result.current.openSettingsPage(undefined));

  expect(view.result.current.settingsPage).toBeUndefined();
  expect(view.result.current.settingsDestination?.category).toBe('general');

  act(() => view.result.current.openSettings());

  expect(view.result.current.settingsDestination).toBeUndefined();

  act(() => view.result.current.closeSettings());

  expect(view.result.current.isSettingsOpen).toBe(false);
  expect(view.result.current.chatId).toBe('alex');
});

it('treats invalid settings destinations as the overview and ignores invalid nested pages', () => {
  window.history.replaceState(null, '', '/?settings=missing&settingsPage=power');
  const view = renderHook(useAppNavigation, { wrapper: BrowserRouter });

  expect(view.result.current.isSettingsOpen).toBe(true);
  expect(view.result.current.settingsDestination).toBeUndefined();
  expect(view.result.current.settingsPage).toBeUndefined();
});

it('returns through existing history so Forward can reopen the settings category', async () => {
  window.history.replaceState(null, '', '/?settings=overview');
  const view = renderHook(useAppNavigation, { wrapper: BrowserRouter });
  act(() => {
    view.result.current.openSettings({
      id: 'notifications',
      title: 'Notifications and Sounds',
      category: 'notifications',
      path: '',
      keywords: '',
    });
  });

  expect(view.result.current.settingsDestination?.category).toBe('notifications');

  act(() => view.result.current.openSettings());

  await waitFor(() => expect(view.result.current.settingsDestination).toBeUndefined());

  act(() => window.history.forward());

  await waitFor(() => {
    expect(view.result.current.settingsDestination?.category).toBe('notifications');
  });
});
