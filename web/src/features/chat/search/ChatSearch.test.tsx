// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatSearch } from './ChatSearch';
import { createInitialState } from '../demo/fixtures';

afterEach(cleanup);

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
