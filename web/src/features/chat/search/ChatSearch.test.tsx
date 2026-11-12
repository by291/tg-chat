// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatSearch } from './ChatSearch';
import { canonicalFixture } from '../data/messageFixtures.test-support';
import { createInitialState } from '../demo/fixtures';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('keeps a paged query and its filters when switching narrow search views', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const loadPage = vi.fn().mockResolvedValue({
    hits: [canonicalFixture({ id: 'newest-match' })],
    next_cursor: 'older-matches',
    observation_cursor: 'observation',
    is_truncated: false,
  });
  const onJump = vi.fn();
  render(
    <ChatSearch
      messages={[]}
      canFilterSender={false}
      onJump={onJump}
      onClose={vi.fn()}
      source={{
        conversationId: 'group',
        visibilityKey: 'current',
        loadPage,
        onJumpToDate: vi.fn(),
      }}
    />,
  );

  const input = screen.getByRole('textbox', { name: 'Search in this conversation' });
  const dateFrom = screen.getByLabelText('From date');
  fireEvent.change(dateFrom, { target: { value: '2026-11-01' } });
  fireEvent.change(input, { target: { value: 'archive' } });
  await screen.findByRole('button', { name: 'More results' });
  fireEvent.click(screen.getByRole('button', { name: 'Show in chat' }));

  expect(onJump).toHaveBeenCalledWith('newest-match');
  expect(screen.getByRole('status', { name: 'Search position' }).textContent).toBe('1 of 1+');
  fireEvent.click(screen.getByRole('button', { name: 'Show search results' }));
  expect(screen.getByRole('button', { name: 'More results' })).toBeTruthy();
  expect(input).toHaveProperty('value', 'archive');
  expect(screen.getByLabelText('From date')).toHaveProperty('value', '2026-11-01');
  expect(loadPage).toHaveBeenCalledOnce();
});

function renderSearch() {
  const onJump = vi.fn();
  const onClose = vi.fn();
  const messages = createInitialState().messages.filter((message) => message.chatId === 'lab');
  render(<ChatSearch messages={messages} canFilterSender onJump={onJump} onClose={onClose} />);
  const input = screen.getByRole('textbox', { name: 'Search in this conversation' });
  fireEvent.change(input, { target: { value: 'Archive note' } });
  // prettier-ignore
  return {
    input,
    onJump,
    onClose,
  };
}

it('retains input focus while arrows highlight results and confirms only on Enter', () => {
  const { input, onJump } = renderSearch();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });

  expect(document.activeElement).toBe(input);
  expect(onJump).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onJump).toHaveBeenCalledOnce();
  expect(document.activeElement).not.toBe(input);
});

it('leaves IME navigation and confirmation keys to the input method', () => {
  const { input, onJump, onClose } = renderSearch();
  fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: true });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(input, { key: 'Escape', isComposing: true });

  expect(document.activeElement).toBe(input);
  expect(onJump).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('ignores Escape already consumed by an inner control', () => {
  const { onClose } = renderSearch();
  const escape = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  escape.preventDefault();
  fireEvent(document, escape);

  expect(onClose).not.toHaveBeenCalled();
});

it('closes only once when Escape repeats before the exit animation unmounts search', () => {
  const { onClose } = renderSearch();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.keyDown(document, { key: 'Escape' });

  expect(onClose).toHaveBeenCalledOnce();
});

it('selects an authorized sender outside loaded history without searching empty text', async () => {
  const loadPage = vi.fn().mockResolvedValue({
    hits: [],
    is_truncated: false,
    observation_cursor: 'observation',
  });
  const loadSenders = vi
    .fn()
    .mockResolvedValueOnce({ senders: [], next: 'second-page' })
    .mockResolvedValueOnce({ senders: [{ id: 'remote-author', name: 'Remote author' }] });
  render(
    <ChatSearch
      messages={[]}
      canFilterSender
      onJump={vi.fn()}
      onClose={vi.fn()}
      source={{
        conversationId: 'group',
        visibilityKey: 'visible',
        loadPage,
        onJumpToDate: vi.fn(),
        senderRoster: { revision: 'current', loadPage: loadSenders },
      }}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Search members' }));
  fireEvent.click(await screen.findByRole('button', { name: 'More members' }));
  const sender = await screen.findByRole('button', { name: /Remote author/ });
  vi.useFakeTimers();
  fireEvent.click(sender);
  await act(async () => vi.runOnlyPendingTimersAsync());
  expect(screen.getByText('Enter text or choose a media type to search by sender.')).toBeTruthy();
  expect(loadPage).not.toHaveBeenCalled();
  vi.useRealTimers();
  expect(loadSenders).toHaveBeenLastCalledWith({
    conversationId: 'group',
    after: 'second-page',
  });

  const input = screen.getByRole('textbox', { name: 'Search in this conversation' });
  fireEvent.change(input, { target: { value: 'shared notes' } });
  await waitFor(() => {
    expect(loadPage).toHaveBeenCalledWith({
      query: { query: 'shared notes', conversation_id: 'group', sender_id: 'remote-author' },
      signal: expect.any(AbortSignal),
    });
  });
});
