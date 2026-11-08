// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PinnedMessageBar } from './PinnedMessageBar';
import type { Message } from './model';

afterEach(cleanup);

function createPin(index: number): Message {
  return {
    id: `pin-${index}`,
    chatId: 'dev',
    authorId: 'you',
    authorName: 'You',
    createdAt: index,
    text: `Message ${index}`,
    reactions: [],
    isPinned: true,
  };
}

it('continues with the older pin when the currently previewed pin is removed', () => {
  const messages = Array.from({ length: 3 }, (_, index) => createPin(index));
  const onJump = vi.fn();
  const onUnpin = vi.fn();
  const view = render(
    <PinnedMessageBar
      messages={messages}
      onJump={onJump}
      onUnpin={onUnpin}
      onOpenList={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pinned Message: Message 2' }));
  expect(onJump).toHaveBeenCalledWith('pin-2');
  fireEvent.click(screen.getByRole('button', { name: 'Unpin message' }));
  expect(onUnpin).toHaveBeenCalledWith(messages[1]);
  view.rerender(
    <PinnedMessageBar
      messages={[messages[0], messages[2]]}
      onJump={onJump}
      onUnpin={onUnpin}
      onOpenList={() => {}}
    />,
  );
  expect(screen.getByRole('button', { name: 'Pinned Message #1: Message 0' })).toBeTruthy();
});
