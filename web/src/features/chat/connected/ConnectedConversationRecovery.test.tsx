// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChatOwner } from '../data/ChatOwner';
import type { Conversation } from '../data/messageModels';
import { createChatOwnerFixture, DIRECT, SELECTION, USER } from '../data/chatOwner.test-support';
import { canonicalFixture, cursorFixture } from '../data/messageFixtures.test-support';
import { ConnectedChat } from './ConnectedChat';

const VIEWPORT_HEIGHT = 500;
const CONVERSATION = {
  ...DIRECT,
  peer_name: 'Evidence Reporter',
  last_sequence: '2',
  summary_text: 'Retained shared history',
};
const RESTORED_CONVERSATION = {
  ...CONVERSATION,
  version: '3',
  generation: '3',
};
const RETAINED_MESSAGE = canonicalFixture({
  conversation_id: CONVERSATION.id,
  sequence: '2',
  content: {
    schema_version: 1,
    text: 'Retained shared history',
    custom_emoji: [],
  },
});
const EARLIER_MESSAGE = canonicalFixture({
  id: 'earlier-message',
  conversation_id: CONVERSATION.id,
  content: {
    schema_version: 1,
    text: 'Earlier history window',
    custom_emoji: [],
  },
});

function ChatWorkspace({ owner }: { owner: ChatOwner }) {
  const [isConversationOpen, setIsConversationOpen] = useState(true);
  return (
    <ConnectedChat
      owner={owner}
      user={USER}
      isConversationOpen={isConversationOpen}
      onShowDirectory={() => setIsConversationOpen(false)}
      onShowConversation={() => setIsConversationOpen(true)}
      onSettings={() => {}}
      onContacts={() => {}}
      onCommunities={() => {}}
      onCreateCommunity={() => {}}
      onOpenCommunity={() => {}}
    />
  );
}

async function openChat(options: { initialHistory?: Promise<void> } = {}) {
  let syncPosition = 0;
  let timelineRequests = 0;
  let conversation: Conversation | null = CONVERSATION;
  const { owner } = createChatOwnerFixture({
    conversation: CONVERSATION,
    history: async (request) => {
      const query = new URL(request.url).searchParams;
      const isEarlierWindow = query.has('around');
      const isPinDirectory = query.get('pinned') === 'true';
      const message = isEarlierWindow ? EARLIER_MESSAGE : RETAINED_MESSAGE;
      if (!isPinDirectory) {
        timelineRequests += 1;
        await options.initialHistory;
      }

      return Response.json({
        messages: isPinDirectory ? [] : [message],
        anchor_id: isEarlierWindow ? message.id : undefined,
        preceding_message: null,
        has_older: !isEarlierWindow && !isPinDirectory,
        has_newer: isEarlierWindow,
        generation: conversation?.generation ?? CONVERSATION.generation,
        observation_cursor: cursorFixture(syncPosition),
      });
    },
    transport: async (request) => {
      const cursor = cursorFixture(syncPosition);
      const hasChanges = new URL(request.url).searchParams.get('cursor') !== cursor;
      const group = {
        position: String(syncPosition),
        conversation_id: CONVERSATION.id,
        conversation,
        removed_message_id: null,
        message: null,
      };
      return Response.json({
        account_settings_version: '0',
        groups: hasChanges ? [group] : [],
        cursor,
        observation_cursor: cursor,
        has_more: false,
      });
    },
  });
  await owner.start();
  const opening = owner.select(SELECTION);
  if (!options.initialHistory) {
    await opening;
  }
  render(<ChatWorkspace owner={owner} />);

  async function changeAccess(state: 'removed' | 'restored') {
    syncPosition += 1;
    conversation = state === 'removed' ? null : RESTORED_CONVERSATION;
    await act(() => owner.catchUp());
  }

  return {
    owner,
    changeAccess,
    opening,
    getTimelineRequests: () => timelineRequests,
  };
}

function conversationButton() {
  const directory = screen.getByRole('complementary', { name: 'Conversations' });
  return within(directory).getByRole('button', { name: /^Evidence Reporter/ });
}

function stubLayout({ isHandheld }: { isHandheld: boolean }) {
  vi.stubGlobal('matchMedia', () => ({
    matches: isHandheld,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => {
  class LayoutObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', LayoutObserver);
  vi.stubGlobal('IntersectionObserver', LayoutObserver);
  stubLayout({ isHandheld: false });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(['observed quarantine', 'missed quarantine'])(
  'reloads retained history when reopening the same chat after %s',
  async (transition) => {
    const user = userEvent.setup();
    const { owner, changeAccess } = await openChat();
    try {
      await screen.findByRole('group', { name: 'Message: Retained shared history' });
      if (transition === 'observed quarantine') {
        await changeAccess('removed');
        expect(
          screen.queryByRole('group', { name: 'Message: Retained shared history' }),
        ).toBeNull();
      }

      await changeAccess('restored');
      await user.click(conversationButton());

      expect(
        await screen.findByRole('group', { name: 'Message: Retained shared history' }),
      ).toBeTruthy();
    } finally {
      owner.dispose();
    }
  },
);

it.each(['original access', 'refreshed access'])(
  'keeps the authorized handheld view when returning after %s',
  async (access) => {
    stubLayout({ isHandheld: true });
    const user = userEvent.setup();
    const { owner, changeAccess } = await openChat();
    try {
      if (access === 'refreshed access') {
        await changeAccess('restored');
      }
      await act(() => owner.jumpToMessage(EARLIER_MESSAGE.id));
      await act(() => owner.setDraft({ text: 'Unsent local words' }));
      const earlierMessage = await screen.findByRole('group', {
        name: 'Message: Earlier history window',
      });
      fireEvent.contextMenu(earlierMessage);
      await user.click(await screen.findByRole('menuitem', { name: 'Select' }));

      await user.click(screen.getByRole('button', { name: 'Back to conversations' }));
      await user.click(conversationButton());

      expect(screen.getByRole('group', { name: 'Message: Earlier history window' })).toBeTruthy();
      expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe(
        'Unsent local words',
      );
      expect(
        screen.getByRole('checkbox', { name: 'Select message from Author', checked: true }),
      ).toBeTruthy();
    } finally {
      owner.dispose();
    }
  },
);

it('keeps the in-flight first page when reopening the same authorized chat', async () => {
  const user = userEvent.setup();
  let releaseHistory!: () => void;
  const initialHistory = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  const { owner, opening, getTimelineRequests } = await openChat({ initialHistory });
  try {
    await screen.findByText('Loading messages…');
    await user.click(conversationButton());

    expect(getTimelineRequests()).toBe(1);
    await act(async () => {
      releaseHistory();
      await opening;
    });
    expect(
      await screen.findByRole('group', { name: 'Message: Retained shared history' }),
    ).toBeTruthy();
  } finally {
    releaseHistory();
    owner.dispose();
  }
});
