// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import { conversationFixture } from '@/features/chat/data/messageFixtures.test-support';
import { CommunityDiscovery } from './CommunityDiscovery';

afterEach(cleanup);

const readingGroup = {
  id: 'reading',
  title: 'Reading Group',
  description: 'Book discussion',
  kind: 'group',
  public_handle: 'reading',
  is_public: true,
  requires_approval: true,
  member_count: '8',
};

const newsChannel = {
  ...readingGroup,
  id: 'news',
  title: 'News Desk',
  description: 'Daily headlines',
  kind: 'channel',
  public_handle: 'news',
  requires_approval: false,
};

interface DiscoveryRequest {
  params: { query: { kind?: string; search?: string } };
}

function discoveryFixture() {
  const joined = conversationFixture({
    id: 'staff',
    kind: 'channel',
    title: 'Staff News',
  });
  let isRequested = false;
  const fetchResults = vi.fn(async (_path: string, { params }: DiscoveryRequest) => {
    const { kind, search } = params.query;
    const matching = [readingGroup, newsChannel].filter((result) => {
      const matchesKind = !kind || kind === result.kind;
      const matchesSearch = !search || result.title.toLowerCase().includes(search.toLowerCase());
      return matchesKind && matchesSearch;
    });
    const items = matching.map((result) => {
      return {
        ...result,
        has_pending_request: result.id === readingGroup.id && isRequested,
      };
    });
    return { data: { items, next: null } };
  });
  const command = vi.fn(async ({ conversationId }: { conversationId: string }) => {
    if (conversationId === readingGroup.id) {
      isRequested = true;
      return {};
    }

    return {
      conversation: conversationFixture({
        id: newsChannel.id,
        kind: 'channel',
        title: newsChannel.title,
      }),
    };
  });
  const snapshot = { conversations: [joined] };
  const chat = {
    communities: { command },
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
  } as unknown as ChatOwner;
  const session = {
    client: { GET: fetchResults },
  } as unknown as SessionOwner;

  function rejectRequest() {
    isRequested = false;
  }

  return { chat, session, joined, command, fetchResults, rejectRequest };
}

it('filters live search by kind, opens admitted chats, and subscribes to a public channel', async () => {
  const { chat, session, joined, command, fetchResults } = discoveryFixture();
  const onAdmitted = vi.fn();
  render(<CommunityDiscovery chat={chat} session={session} onAdmitted={onAdmitted} />);

  await screen.findByRole('article', { name: 'Reading Group' });
  fireEvent.click(screen.getByRole('button', { name: 'Channels' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Community search' }), {
    target: { value: 'News' },
  });

  await waitFor(() => {
    expect(fetchResults).toHaveBeenLastCalledWith('/api/v1/communities', {
      params: { query: { search: 'News', kind: 'channel', after: undefined } },
    });
  });
  const joinedRow = await screen.findByRole('article', { name: joined.title });
  fireEvent.click(within(joinedRow).getByRole('button', { name: `Open ${joined.title}` }));
  expect(onAdmitted).toHaveBeenCalledWith(joined);
  expect(command).not.toHaveBeenCalled();
  expect(screen.queryByRole('article', { name: 'Reading Group' })).toBeNull();

  const result = await screen.findByRole('article', { name: 'News Desk' });
  fireEvent.click(within(result).getByRole('button', { name: 'Subscribe' }));
  await waitFor(() => {
    expect(onAdmitted).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'news' }));
  });
});

it('restores an approval request from the server without opening community history', async () => {
  const { chat, session, command, rejectRequest } = discoveryFixture();
  const onAdmitted = vi.fn();
  const { unmount } = render(
    <CommunityDiscovery chat={chat} session={session} onAdmitted={onAdmitted} />,
  );

  const result = await screen.findByRole('article', { name: 'Reading Group' });
  fireEvent.click(within(result).getByRole('button', { name: 'Request to join' }));
  await within(result).findByText('Request sent');
  expect(onAdmitted).not.toHaveBeenCalled();
  unmount();

  render(<CommunityDiscovery chat={chat} session={session} onAdmitted={onAdmitted} />);
  const restored = await screen.findByRole('article', { name: 'Reading Group' });
  expect(within(restored).getByText('Request sent')).toBeTruthy();
  expect(within(restored).queryByRole('button')).toBeNull();
  expect(command).toHaveBeenCalledOnce();

  rejectRequest();
  fireEvent.focus(window);
  await within(restored).findByRole('button', { name: 'Request to join' });
});

it('keeps a newer search open when an earlier admission finishes', async () => {
  const { chat, session, command } = discoveryFixture();
  const onAdmitted = vi.fn();
  const accepted = conversationFixture({
    id: newsChannel.id,
    kind: 'channel',
    title: newsChannel.title,
  });
  let completeAdmission = () => {};
  command.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        completeAdmission = () => resolve({ conversation: accepted });
      }),
  );
  render(<CommunityDiscovery chat={chat} session={session} onAdmitted={onAdmitted} />);

  const original = await screen.findByRole('article', { name: newsChannel.title });
  fireEvent.click(within(original).getByRole('button', { name: 'Subscribe' }));
  fireEvent.click(screen.getByRole('button', { name: 'Groups' }));
  await screen.findByRole('article', { name: readingGroup.title });

  completeAdmission();
  const join = await screen.findByRole('button', { name: 'Request to join' });
  await waitFor(() => {
    expect(join).toHaveProperty('disabled', false);
  });
  expect(onAdmitted).not.toHaveBeenCalled();
});
