// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { createChatOwnerFixture, SAVED, USER } from '../data/chatOwner.test-support';
import { canonicalFixture, cursorFixture } from '../data/messageFixtures.test-support';
import { ConnectedChat } from './ConnectedChat';

const EARLIER_DAY = new Date('2025-10-01T00:00:00');
const LOADED_DAY = new Date('2025-10-08T12:00:00');
const VIEWPORT_HEIGHT = 500;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function historyForDate(request: Request) {
  const dateAnchor = new URL(request.url).searchParams.get('date_at');
  const isEarlierDay = dateAnchor === EARLIER_DAY.toISOString();
  const message = canonicalFixture({
    conversation_id: SAVED.id,
    id: isEarlierDay ? 'earlier-message' : 'current-message',
    sequence: isEarlierDay ? '1' : '2',
    created_at: (isEarlierDay ? EARLIER_DAY : LOADED_DAY).toISOString(),
    content: {
      schema_version: 1,
      text: isEarlierDay ? 'Earlier entry' : 'Current entry',
      custom_emoji: [],
    },
  });
  return Response.json({
    messages: [message],
    anchor_id: isEarlierDay ? message.id : undefined,
    preceding_message: null,
    has_older: !isEarlierDay,
    has_newer: isEarlierDay,
    generation: SAVED.generation,
    observation_cursor: cursorFixture(0),
  });
}

it('opens the remote date anchor when the selected day precedes the loaded timeline', async () => {
  const user = userEvent.setup();
  class LayoutObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', LayoutObserver);
  vi.stubGlobal('IntersectionObserver', LayoutObserver);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT);
  const { owner } = createChatOwnerFixture({
    history: async (request) => historyForDate(request),
  });
  try {
    await owner.start();
    await owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
    render(
      <ConnectedChat
        owner={owner}
        user={USER}
        isConversationOpen
        onShowDirectory={() => {}}
        onShowConversation={() => {}}
        onSettings={() => {}}
        onContacts={() => {}}
        onCommunities={() => {}}
        onCreateCommunity={() => {}}
        onOpenCommunity={() => {}}
      />,
    );
    const composer = screen.getByRole('textbox', { name: 'Message' });
    expect(await screen.findByRole('group', { name: 'Message: Current entry' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Message: Earlier entry' })).toBeNull();

    await user.click(screen.getByRole('button', { name: /Jump to date: October 8/ }));
    const earlierDay = await screen.findByRole('button', { name: 'Wednesday, October 1, 2025' });
    await user.click(earlierDay);
    await waitFor(() =>
      expect(earlierDay.parentElement?.getAttribute('aria-selected')).toBe('true'),
    );
    await user.click(screen.getByRole('button', { name: 'Jump to Date' }));

    expect(await screen.findByRole('group', { name: 'Message: Earlier entry' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBe(composer);
  } finally {
    owner.dispose();
  }
});
