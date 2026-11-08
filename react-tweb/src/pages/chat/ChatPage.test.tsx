// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatPage } from './ChatPage';

const { readStoredState } = vi.hoisted(() => ({
  readStoredState: vi.fn<() => Promise<unknown>>(),
}));

vi.mock('idb-keyval', () => ({
  get: readStoredState,
  set: async () => {},
  del: async () => {},
}));

// Theme animation assets require a browser loader; they do not participate in navigation.
vi.mock('@/features/settings/appearance/ThemeEmoji', () => ({ ThemeEmoji: () => null }));

beforeEach(() => {
  readStoredState.mockReset();
  readStoredState.mockResolvedValue(undefined);
  class LayoutObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal('ResizeObserver', LayoutObserver);
  vi.stubGlobal('IntersectionObserver', LayoutObserver);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal('ClipboardEvent', Event);
  vi.stubGlobal('DragEvent', class extends Event {});
  // Only the sidebar needs a measured viewport for this conversation-selection regression.
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.getAttribute('aria-label') === 'Conversations' ? 600 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360);
  window.history.replaceState(null, '', '/?chat=dev');
});

it('keeps the wallpaper and sidebar frame visible while restoring conversations', async () => {
  let finishRestore: (value: unknown) => void = () => {};
  readStoredState.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRestore = resolve;
      }),
  );
  const view = render(<ChatPage />, { wrapper: BrowserRouter });
  const wallpaper = view.container.querySelector('[data-pattern]');
  expect(wallpaper).not.toBeNull();
  expect(screen.getByLabelText('Chat list').getAttribute('aria-busy')).toBe('true');
  expect(screen.queryByRole('button', { name: /This feels familiar/ })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();

  await act(async () => finishRestore(undefined));

  expect(await screen.findByRole('button', { name: /This feels familiar/ })).toBeTruthy();
  expect(view.container.querySelector('[data-pattern]')).toBe(wallpaper);
  expect(screen.getByLabelText('Chat list').getAttribute('aria-busy')).not.toBe('true');
});

it('leaves the startup frame when conversation storage fails', async () => {
  readStoredState.mockRejectedValue(new Error('Storage is unavailable'));
  render(<ChatPage />, { wrapper: BrowserRouter });

  expect(await screen.findByRole('button', { name: /This feels familiar/ })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('Local storage is unavailable');
  expect(screen.getByLabelText('Chat list').getAttribute('aria-busy')).not.toBe('true');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

it('clears a manual unread marker when reselecting the active chat without adding history', async () => {
  const user = userEvent.setup();
  render(<ChatPage />, { wrapper: BrowserRouter });
  await screen.findByLabelText('Chat list');
  const row = await screen.findByRole('button', { name: /This feels familiar/ });
  fireEvent.contextMenu(row);
  await user.click(await screen.findByRole('menuitem', { name: 'Mark as unread' }));
  expect(screen.getByLabelText('Marked as unread')).toBeTruthy();
  const historyLength = window.history.length;

  await user.click(row);
  await waitFor(() => expect(screen.queryByLabelText('Marked as unread')).toBeNull());
  expect(window.history.length).toBe(historyLength);
});

it('enters selection without replacing the conversation viewport or its focused row', async () => {
  const user = userEvent.setup();
  render(<ChatPage />, { wrapper: BrowserRouter });
  const row = await screen.findByRole('button', { name: /This feels familiar/ });
  const viewport = screen.getByRole('navigation', { name: 'Conversations' });
  fireEvent.contextMenu(row);
  await user.click(await screen.findByRole('menuitem', { name: 'Select' }));

  expect(screen.getByRole('toolbar', { name: 'Selected conversations' })).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Conversations' })).toBe(viewport);
  expect(row.isConnected).toBe(true);
  expect(row.getAttribute('aria-pressed')).toBe('true');
  await user.click(screen.getByRole('button', { name: 'Cancel selection' }));
  expect(screen.getByRole('navigation', { name: 'Conversations' })).toBe(viewport);
  expect(row.isConnected).toBe(true);
});
