// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import { conversationFixture } from '@/features/chat/data/messageFixtures.test-support';
import { CommunityProfile } from './CommunityProfile';
import type { Conversation } from './communityModels';

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

function renderProfile(changes: Partial<Conversation>) {
  const conversation = conversationFixture({
    kind: 'group',
    title: 'Board Games',
    role: 'owner',
    can_manage: true,
    is_public: true,
    public_handle: 'board_games',
    ...changes,
  });
  const member = {
    id: 'member-id',
    display_name: 'Jo Rivera',
    username: 'jo_rivera',
    is_active: true,
    is_banned: false,
    role: 'member',
  };
  const removed = {
    id: 'removed-id',
    display_name: 'Alex Chen',
    username: 'alex_chen',
    is_active: false,
    is_banned: true,
    role: 'member',
  };
  const get = vi.fn().mockResolvedValue({
    data: { items: [member, removed], next: null },
  });
  const command = vi.fn().mockResolvedValue({ conversation });
  const snapshot = { conversations: [conversation] };
  const chat = {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    communities: { command },
  } as unknown as ChatOwner;
  const session = {
    getSnapshot: () => ({ auth: { user: { id: 'owner-id' } } }),
    client: { GET: get },
  } as unknown as SessionOwner;

  render(<CommunityProfile session={session} chat={chat} id={conversation.id} onClose={vi.fn()} />);

  return { get, command, conversation };
}

it('opens the member directory from the profile and confirms a ban from the row menu', async () => {
  const user = userEvent.setup();
  const { get, command, conversation } = renderProfile({});
  const profile = screen.getByRole('dialog', { name: 'Group info' });
  expect(get).not.toHaveBeenCalled();
  await user.click(within(profile).getByRole('button', { name: 'Members' }));

  const row = await screen.findByRole('article', { name: 'Member jo_rivera' });
  expect(screen.queryByRole('article', { name: 'Member alex_chen' })).toBeNull();
  await user.click(within(row).getByRole('button', { name: 'Actions for Jo Rivera' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Ban' }));
  expect(command).not.toHaveBeenCalled();

  const confirmation = await screen.findByRole('dialog', { name: 'Ban member?' });
  await user.click(within(confirmation).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => {
    expect(command).toHaveBeenCalledWith({
      conversationId: conversation.id,
      action: { kind: 'ban', user_id: 'member-id' },
    });
  });
  expect(within(profile).getByRole('button', { name: 'Close community info' })).toBeTruthy();
  await user.click(within(profile).getByRole('button', { name: 'Back to community info' }));
  expect(document.activeElement).toBe(within(profile).getByRole('button', { name: 'Members' }));
});

it('shows banned accounts in their management view', async () => {
  const user = userEvent.setup();
  renderProfile({});
  await user.click(screen.getByRole('button', { name: 'Banned users' }));

  const row = await screen.findByRole('article', { name: 'Member alex_chen' });
  expect(screen.queryByRole('article', { name: 'Member jo_rivera' })).toBeNull();
  await user.click(within(row).getByRole('button', { name: 'Actions for Alex Chen' }));
  expect(await screen.findByRole('menuitem', { name: 'Unban' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: 'Ban' })).toBeNull();
});

it('keeps the subscriber directory and management controls hidden from ordinary subscribers', () => {
  const { get } = renderProfile({
    kind: 'channel',
    role: 'member',
    can_manage: false,
    member_count: '3',
  });

  expect(screen.getByRole('heading', { name: 'Board Games' })).toBeTruthy();
  expect(screen.getByText('3 subscribers')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Subscribers' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Community settings' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Join requests' })).toBeNull();
  expect(get).not.toHaveBeenCalled();
});

it('copies the visible public handle from the profile', async () => {
  const user = userEvent.setup();
  renderProfile({});

  await user.click(screen.getByRole('button', { name: 'Copy public handle' }));
  expect(await navigator.clipboard.readText()).toBe('@board_games');
  expect(await screen.findByText('Public handle copied.')).toBeTruthy();
});
