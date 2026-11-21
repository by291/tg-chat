// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createChatOwnerFixture, SAVED, USER } from '../data/chatOwner.test-support';
import { canonicalFixture, cursorFixture } from '../data/messageFixtures.test-support';
import { ConnectedChat } from './ConnectedChat';

const VIEWPORT_HEIGHT = 500;

function photo(name: string) {
  return {
    occurrence_id: name,
    file_name: name,
    file: {
      file_id: name,
      kind: 'image' as const,
      width: 600,
      height: 1200,
      size_bytes: 100,
      variants: ['thumbnail' as const, 'original' as const],
    },
  };
}

const source = canonicalFixture({
  conversation_id: SAVED.id,
  attachments: [photo('portrait.jpg'), photo('neighbor.jpg')],
});

async function openChat(transport: (request: Request) => Promise<Response>) {
  const { owner, session } = createChatOwnerFixture({
    history: async (request) => {
      const isOtherPage = new URL(request.url).searchParams.has('around');
      const message = isOtherPage
        ? canonicalFixture({
            id: 'other',
            sequence: '2',
            conversation_id: SAVED.id,
          })
        : source;
      return Response.json({
        messages: [message],
        anchor_id: message.id,
        has_older: isOtherPage,
        has_newer: !isOtherPage,
        generation: SAVED.generation,
        observation_cursor: cursorFixture(0),
      });
    },
    transport,
  });
  await owner.start();
  await owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
  render(
    <ConnectedChat
      owner={owner}
      session={session}
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
  return { owner, session };
}

beforeEach(() => {
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('opens a signed portrait independently of a failed neighbor and retries that neighbor', async () => {
  let canLoadNeighbor = false;
  const { owner } = await openChat(async (request) => {
    if (request.url.includes('neighbor.jpg') && !canLoadNeighbor) {
      return Response.error();
    }
    return Response.json({ url: '/signed-preview' });
  });
  try {
    fireEvent.click(await screen.findByRole('button', { name: /Open.*portrait.jpg/ }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByRole('img', { name: 'portrait.jpg' })).toBeTruthy();
    const next = dialog.getByRole('button', { name: 'Next media' });
    await waitFor(() => expect(next).toHaveProperty('disabled', false));
    fireEvent.click(next);
    const retry = await dialog.findByRole('button', { name: 'Retry media' });
    canLoadNeighbor = true;
    fireEvent.click(retry);
    expect(await dialog.findByRole('img', { name: 'neighbor.jpg' })).toBeTruthy();
  } finally {
    owner.dispose();
  }
});

it('keeps the viewer after its history page is replaced and clears it on logout', async () => {
  const { owner, session } = await openChat(async () => Response.json({ url: '/signed' }));
  try {
    fireEvent.click(await screen.findByRole('button', { name: /Open.*portrait.jpg/ }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByRole('img', { name: 'portrait.jpg' })).toBeTruthy();
    await act(() => owner.jumpToMessage('other'));
    expect(document.getElementById('message-message-1')).toBeNull();
    expect(screen.getByRole('dialog').contains(dialog.getByRole('img'))).toBe(true);

    act(() => session.invalidate({ shouldBroadcast: false }));
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  } finally {
    owner.dispose();
  }
});

it('allows cancellation while signing and ignores a late authorization', async () => {
  let release!: (response: Response) => void;
  const signing = new Promise<Response>((resolve) => {
    release = resolve;
  });
  let shouldDelay = false;
  const { owner } = await openChat(async () => {
    return shouldDelay ? signing : Response.json({ url: '/preview' });
  });
  try {
    shouldDelay = true;
    fireEvent.click(await screen.findByRole('button', { name: /Open.*portrait.jpg/ }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('status').textContent).toMatch(/loading/i);
    fireEvent.click(dialog.getByRole('button', { name: /close/i }));
    await act(async () => release(Response.json({ url: '/late' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelector('img[src="/late"]')).toBeNull();
  } finally {
    owner.dispose();
  }
});

it('animates from the clicked occurrence and removes private media on a deletion event', async () => {
  const { owner } = await openChat(async (request) => {
    if (!new URL(request.url).pathname.endsWith('/sync')) {
      return Response.json({ url: '/signed' });
    }
    return Response.json({
      groups: [
        {
          position: '1',
          conversation_id: SAVED.id,
          conversation: { ...SAVED, version: '2' },
          removed_message_id: source.id,
        },
      ],
      cursor: cursorFixture(1),
      observation_cursor: cursorFixture(1),
      has_more: false,
    });
  });
  try {
    const thumbnail = await screen.findByRole('button', { name: /Open.*neighbor.jpg/ });
    thumbnail.getBoundingClientRect = () => DOMRect.fromRect({ width: 200, height: 400 });
    fireEvent.click(thumbnail);
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByRole('img', { name: 'neighbor.jpg' })).toBeTruthy();
    expect(thumbnail.getAttribute('data-viewer-source')).toBe('true');

    await act(() => owner.catchUp());
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(document.querySelector('img[src="/signed"]')).toBeNull();
  } finally {
    owner.dispose();
  }
});
