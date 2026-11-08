// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatApp } from './ChatApp';

vi.mock('idb-keyval', () => ({
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
}));

// Theme animation assets require a browser loader; they do not participate in navigation.
vi.mock('../chat/sidebar/ThemeEmoji', () => ({ ThemeEmoji: () => null }));

beforeEach(() => {
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

it('clears a manual unread marker when reselecting the active chat without adding history', async () => {
  const user = userEvent.setup();
  render(<ChatApp />, { wrapper: BrowserRouter });
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
  render(<ChatApp />, { wrapper: BrowserRouter });
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
