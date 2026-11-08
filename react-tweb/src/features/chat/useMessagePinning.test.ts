// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMessagePinning } from './useMessagePinning';
import type { Message } from '@/domain/messages/message';

const message: Message = {
  id: 'pin-target',
  chatId: 'dev',
  authorId: 'you',
  authorName: 'You',
  text: 'Keep this message',
  createdAt: 1,
  reactions: [],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('closes confirmation before committing the captured pin state', () => {
  vi.useFakeTimers();
  const dispatch = vi.fn();
  const { result } = renderHook(() => useMessagePinning(dispatch));
  act(() => result.current.requestChange(message));
  act(() => result.current.confirmChange());
  expect(result.current.request).toBeUndefined();
  expect(dispatch).not.toHaveBeenCalled();
  act(() => vi.runAllTimers());
  expect(dispatch).toHaveBeenCalledWith({
    type: 'pin',
    chatId: 'dev',
    messageId: message.id,
    isPinned: true,
  });
});

it('commits to the original chat after leaving the conversation during popup dismissal', () => {
  vi.useFakeTimers();
  const dispatch = vi.fn();
  const { result, unmount } = renderHook(() => useMessagePinning(dispatch));
  act(() => result.current.requestChange(message));
  act(() => result.current.confirmChange());
  unmount();
  act(() => vi.runAllTimers());
  expect(dispatch).toHaveBeenCalledWith({
    type: 'pin',
    chatId: 'dev',
    messageId: message.id,
    isPinned: true,
  });
});
