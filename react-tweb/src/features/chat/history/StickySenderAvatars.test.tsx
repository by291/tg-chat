// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { createInitialState } from '../demo/fixtures';
import { SenderProfileProvider } from '../details/SenderProfileProvider';
import { chatReducer } from '../state/reducer';
import { StickySenderAvatars } from './StickySenderAvatars';

const group = {
  key: 'message',
  authorId: 'mia',
  authorName: 'Mia',
  start: 0,
  end: 240,
  firstRowIndex: 0,
  lastRowIndex: 2,
};

function SenderHistory({
  authorId = 'mia',
  isSelecting = false,
  isPreview = false,
}: {
  authorId?: string;
  isSelecting?: boolean;
  isPreview?: boolean;
}) {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);
  return (
    <SenderProfileProvider
      state={state}
      dispatch={dispatch}
      onSelectConversation={(chatId) => dispatch({ type: 'select-chat', chatId })}
      onOpenMedia={vi.fn()}
    >
      <StickySenderAvatars
        groups={[{ ...group, authorId }]}
        isSelecting={isSelecting}
        isPreview={isPreview}
      />
      <output aria-label="Active chat">{state.activeChatId}</output>
      <output aria-label="Local peers">{state.localConversations?.length ?? 0}</output>
    </SenderProfileProvider>
  );
}

afterEach(cleanup);

it('opens the sender profile without navigating, then messages that peer', async () => {
  render(<SenderHistory />);
  const activeChat = screen.getByLabelText('Active chat').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Open profile for Mia' }));

  const dialog = await screen.findByRole('dialog', { name: 'User Info' });
  expect(within(dialog).getByRole('heading', { name: 'Mia Chen' })).toBeTruthy();
  expect(within(dialog).queryByRole('tablist')).toBeNull();
  expect(within(dialog).queryByText('No shared media yet')).toBeNull();
  expect(screen.getByLabelText('Active chat').textContent).toBe(activeChat);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Message' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByLabelText('Active chat').textContent).toBe('mia');
});

it('closes the profile without creating an unknown peer conversation', async () => {
  render(<SenderHistory authorId="unknown-peer" />);
  fireEvent.click(screen.getByRole('button', { name: 'Open profile for Mia' }));
  const dialog = await screen.findByRole('dialog', { name: 'User Info' });
  expect(within(dialog).getByRole('heading', { name: /^Mia$/ })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close chat information' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByLabelText('Local peers').textContent).toBe('0');
});

it('creates a conversation only when messaging an unknown sender', async () => {
  render(<SenderHistory authorId="unknown-peer" />);
  fireEvent.click(screen.getByRole('button', { name: 'Open profile for Mia' }));
  const dialog = await screen.findByRole('dialog', { name: 'User Info' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Message' }));
  expect(screen.getByLabelText('Active chat').textContent).toBe('contact:unknown-peer');
  expect(screen.getByLabelText('Local peers').textContent).toBe('1');
});

it('navigates directly when the sender is a broadcast channel', () => {
  const state = createInitialState();
  render(<SenderHistory authorId="webk" />);
  fireEvent.click(screen.getByRole('button', { name: 'Open profile for Mia' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByLabelText('Active chat').textContent).not.toBe(state.activeChatId);
  expect(screen.getByLabelText('Active chat').textContent).toBe('webk');
});

it.each([
  { isSelecting: true, isPreview: false },
  { isSelecting: false, isPreview: true },
])('keeps the avatar passive in selection or preview mode: %j', (mode) => {
  render(<SenderHistory {...mode} />);
  expect(screen.queryByRole('button', { name: /Open profile/ })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('returns keyboard focus to the sender avatar after Escape closes the profile', async () => {
  const user = userEvent.setup();
  render(<SenderHistory />);
  const avatar = screen.getByRole('button', { name: 'Open profile for Mia' });
  await user.tab();
  expect(document.activeElement).toBe(avatar);
  await user.keyboard('{Enter}');
  await screen.findByRole('dialog', { name: 'User Info' });

  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(avatar));
});

it('toggles mute for an uncached sender without creating a conversation', async () => {
  render(<SenderHistory authorId="unknown-peer" />);
  fireEvent.click(screen.getByRole('button', { name: 'Open profile for Mia' }));
  const dialog = await screen.findByRole('dialog', { name: 'User Info' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Mute' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Unmute' }));
  expect(within(dialog).getByRole('button', { name: 'Mute' })).toBeTruthy();
  expect(screen.getByLabelText('Local peers').textContent).toBe('0');
});
