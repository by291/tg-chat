// @vitest-environment jsdom
import { ConversationDirectoryProvider } from '@/features/conversations/ConversationDirectory';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { conversations, createInitialState } from '../demo/fixtures';
import { chatReducer } from '../state/reducer';
import type { ChatState } from '@/features/chat/state/chatState';
import type { Message } from '@/domain/messages/message';
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

function DetailsScreen({
  initialState,
  conversationId = 'dev',
  messages,
}: {
  initialState?: ChatState;
  conversationId?: string;
  messages?: Message[];
}) {
  const [state, dispatch] = useReducer(
    chatReducer,
    initialState,
    (savedState) => savedState ?? createInitialState(),
  );
  const conversation = conversations.find((candidate) => candidate.id === conversationId)!;

  return (
    <ConversationDirectoryProvider state={state}>
      <ChatDetails
        conversation={conversation}
        messages={
          messages ?? state.messages.filter((message) => message.chatId === conversation.id)
        }
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
    </ConversationDirectoryProvider>
  );
}

it('excludes unsaved private peers from the add-members contact choices', async () => {
  const user = userEvent.setup();
  const state = createInitialState();
  state.localConversations = [
    {
      id: 'contact:maya',
      kind: 'private',
      title: 'Maya Chen',
      subtitle: '+1 202 555 0142',
      initials: 'MC',
      color: 'blue',
      preview: '',
      time: '',
      isContact: false,
    },
  ];
  render(<DetailsScreen initialState={state} />);
  await user.click(screen.getByRole('button', { name: 'Add Members' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add Members' });

  expect(within(dialog).queryByRole('checkbox', { name: 'Maya Chen' })).toBeNull();
  expect(within(dialog).getByRole('checkbox', { name: 'Alex Morgan' })).toBeTruthy();
});

it('keeps mute state while switching between members and shared file categories', async () => {
  const user = userEvent.setup();
  const state = createInitialState();
  state.messages.push({
    ...state.messages[0],
    id: 'shared-file',
    chatId: 'dev',
    media: {
      kind: 'document',
      name: 'notes.txt',
      url: '/notes.txt',
      mimeType: 'text/plain',
      size: 16,
    },
  });
  render(<DetailsScreen initialState={state} />);

  await user.click(screen.getByRole('button', { name: 'Mute' }));
  expect(screen.getByRole('button', { name: 'Unmute' })).toBeTruthy();
  await user.click(screen.getByRole('tab', { name: 'Files' }));
  expect(screen.getByRole('link', { name: 'notes.txt' })).toBeTruthy();
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

it('shows a single populated category without an unnecessary tab bar', () => {
  const messages = createInitialState().messages;
  const photo = messages.find((message) => message.attachment)!;
  render(<DetailsScreen conversationId="mia" messages={[photo]} />);

  expect(screen.queryByRole('tablist')).toBeNull();
  expect(screen.getByRole('img', { name: photo.attachment!.name })).toBeTruthy();
  expect(screen.queryByText(/No shared/)).toBeNull();
});

it('falls back to remaining content when the active category becomes empty', async () => {
  const user = userEvent.setup();
  const messages = createInitialState().messages;
  const photo = messages.find((message) => message.attachment)!;
  const view = render(<DetailsScreen messages={[photo]} />);
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Members', 'Media']);
  await user.click(screen.getByRole('tab', { name: 'Media' }));
  expect(screen.getByRole('img', { name: photo.attachment!.name })).toBeTruthy();

  view.rerender(<DetailsScreen messages={[]} />);
  expect(screen.queryByRole('tablist')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
  expect(await screen.findByText('Alex')).toBeTruthy();
});
