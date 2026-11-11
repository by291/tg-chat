// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatSearch } from './ChatSearch';
import { createInitialState } from '../demo/fixtures';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
