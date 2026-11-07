// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { conversations, createInitialState } from '../demo/fixtures';
import { chatReducer } from '../state/reducer';
import { ChatDetails } from './ChatDetails';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function DetailsScreen() {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);
  const conversation = conversations[0];
  return (
    <ChatDetails
      conversation={conversation}
      messages={state.messages.filter((message) => message.chatId === conversation.id)}
      state={state}
      dispatch={dispatch}
      isOpen
      isMuted={state.conversationPreferences?.dev?.isMuted ?? false}
      onToggleMute={() =>
        dispatch({
          type: 'update-conversations',
          chatIds: ['dev'],
          changes: { isMuted: !state.conversationPreferences?.dev?.isMuted },
        })
      }
      onClose={() => {}}
      onOpenMedia={() => {}}
    />
  );
}

it('keeps mute state while switching between members and shared file categories', async () => {
  const user = userEvent.setup();
  render(<DetailsScreen />);

  await user.click(screen.getByRole('button', { name: 'Mute' }));
  expect(screen.getByRole('button', { name: 'Unmute' })).toBeTruthy();
  await user.click(screen.getByRole('tab', { name: 'Files' }));
  expect(screen.getByText('No shared files yet')).toBeTruthy();
  await waitFor(() => {
    expect(screen.queryByRole('tabpanel', { name: 'Members' })).toBeNull();
  });
  await user.click(screen.getByRole('tab', { name: 'Members' }));
  expect(screen.getByText('Alex')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Unmute' })).toBeTruthy();
});

it('requires confirmation before leaving the group', async () => {
  const user = userEvent.setup();
  render(<DetailsScreen />);

  await user.click(screen.getByRole('button', { name: 'Leave group' }));
  expect(await screen.findByRole('alertdialog')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Leave group' })).toBeTruthy();
});
