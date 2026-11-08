// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInitialState } from '@/features/chat/demo/fixtures';
import { ConversationDirectoryProvider, useConversationDirectory } from './ConversationDirectory';

const INITIAL_TIME = 10_000;
const FIRST_MUTE_DURATION = 1_000;
const SECOND_MUTE_DURATION = 2_000;

function MuteStatus({ chatId }: { chatId: string }) {
  const { entriesById } = useConversationDirectory();
  const conversation = entriesById.get(chatId);
  return <output aria-label={chatId}>{conversation?.isMuted ? 'muted' : 'unmuted'}</output>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(INITIAL_TIME);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('refreshes every consumer at successive mute deadlines without another state update', () => {
  const state = createInitialState();
  state.conversationPreferences = {
    dev: { isMuted: true, mutedUntil: INITIAL_TIME + FIRST_MUTE_DURATION },
    design: { isMuted: true, mutedUntil: INITIAL_TIME + SECOND_MUTE_DURATION },
  };
  render(
    <ConversationDirectoryProvider state={state}>
      <MuteStatus chatId="dev" />
      <MuteStatus chatId="design" />
    </ConversationDirectoryProvider>,
  );

  expect(screen.getByLabelText('dev').textContent).toBe('muted');

  act(() => vi.advanceTimersByTime(FIRST_MUTE_DURATION));

  expect(screen.getByLabelText('dev').textContent).toBe('unmuted');
  expect(screen.getByLabelText('design').textContent).toBe('muted');

  act(() => vi.advanceTimersByTime(SECOND_MUTE_DURATION - FIRST_MUTE_DURATION));

  expect(screen.getByLabelText('design').textContent).toBe('unmuted');
});

it('refreshes an expired mute after a background pause when the window regains focus', () => {
  const state = createInitialState();
  state.conversationPreferences = {
    dev: { isMuted: true, mutedUntil: INITIAL_TIME + FIRST_MUTE_DURATION },
  };
  render(
    <ConversationDirectoryProvider state={state}>
      <MuteStatus chatId="dev" />
    </ConversationDirectoryProvider>,
  );

  act(() => {
    vi.setSystemTime(INITIAL_TIME + SECOND_MUTE_DURATION);
    window.dispatchEvent(new Event('focus'));
  });

  expect(screen.getByLabelText('dev').textContent).toBe('unmuted');
});
