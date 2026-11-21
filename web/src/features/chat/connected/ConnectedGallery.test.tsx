// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createChatOwnerFixture, SAVED, USER } from '../data/chatOwner.test-support';
import { canonicalFixture, cursorFixture } from '../data/messageFixtures.test-support';
import { findPhotoSource } from '@/features/media/mediaViewerTransition';
import { ConnectedChat } from './ConnectedChat';

const VIEWPORT_HEIGHT = 500;
const PORTRAIT_OCCURRENCE_ID = 'f381e546-d3c0-45c0-8298-af09bcbe8488';
const NEIGHBOR_OCCURRENCE_ID = 'ba760eaa-6e9e-4dd8-8e73-115d850dd672';

function photo(name: string, occurrenceId: string) {
  return {
    occurrence_id: occurrenceId,
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
  attachments: [
    photo('portrait.jpg', PORTRAIT_OCCURRENCE_ID),
    photo('neighbor.jpg', NEIGHBOR_OCCURRENCE_ID),
  ],
});

function deferredSignature() {
  let release!: (response: Response) => void;
  const signing = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { signing, release };
}

async function openChat(transport: (request: Request) => Promise<Response>) {
  const { owner, session } = createChatOwnerFixture({
    history: async (request) => {
      const isOtherPage = new URL(request.url).searchParams.has('around');
      const message = isOtherPage
        ? canonicalFixture({
            id: 'other',
            attachments: [photo('other-copy.jpg', PORTRAIT_OCCURRENCE_ID)],
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
    if (request.url.includes(NEIGHBOR_OCCURRENCE_ID) && !canLoadNeighbor) {
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

it('keeps the viewer after paging without adopting another message’s occurrence before logout', async () => {
  const { owner, session } = await openChat(async () => Response.json({ url: '/signed' }));
  try {
    const thumbnail = await screen.findByRole('button', { name: /Open.*portrait.jpg/ });
    const clickedId = thumbnail.dataset.photoId!;
    fireEvent.click(thumbnail);
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByRole('img', { name: 'portrait.jpg' })).toBeTruthy();
    await act(() => owner.jumpToMessage('other'));
    const replacement = document.querySelector<HTMLButtonElement>(
      'button[aria-label*="other-copy"]',
    )!;
    replacement.getBoundingClientRect = () => DOMRect.fromRect({ width: 200, height: 400 });
    expect(findPhotoSource(clickedId)).toBeNull();
    expect(document.getElementById('message-message-1')).toBeNull();
    expect(screen.getByRole('dialog').contains(dialog.getByRole('img'))).toBe(true);

    act(() => session.invalidate({ shouldBroadcast: false }));
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  } finally {
    owner.dispose();
  }
});

it('allows cancellation while signing and ignores a late authorization', async () => {
  const { signing, release } = deferredSignature();
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

it('finishes an original download started before the same occurrence finishes signing', async () => {
  const preview = deferredSignature();
  const original = deferredSignature();
  const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.href);
  });
  let shouldDelay = false;
  const { owner } = await openChat(async (request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith(`/${source.id}/attachments/${PORTRAIT_OCCURRENCE_ID}/original`)) {
      return original.signing;
    }
    return shouldDelay ? preview.signing : Response.json({ url: '/thumbnail' });
  });
  try {
    const thumbnail = await screen.findByRole('button', { name: /Open.*portrait.jpg/ });
    shouldDelay = true;
    fireEvent.click(thumbnail);
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Download image' }));
    await act(async () => preview.release(Response.json({ url: '/gallery-photo' })));
    expect(await dialog.findByRole('img', { name: 'portrait.jpg' })).toBeTruthy();
    await act(async () =>
      original.release(Response.json({ url: 'https://example.test/original' })),
    );
    expect(downloads).toEqual(['https://example.test/original']);
  } finally {
    owner.dispose();
  }
});

it.each(['renewal rejected', 'renewed photo fails'])(
  'keeps other slides available and retries a signed neighbor after %s',
  async (failure) => {
    let stage: 'initial' | 'renewing' | 'retry' = 'initial';
    const { owner } = await openChat(async (request) => {
      if (stage === 'renewing' && failure === 'renewal rejected') {
        return Response.error();
      }
      const path = new URL(request.url).pathname;
      return Response.json({ url: `/objects/${stage}${path}` });
    });
    try {
      fireEvent.click(await screen.findByRole('button', { name: /Open.*portrait.jpg/ }));
      const dialog = within(await screen.findByRole('dialog'));
      await dialog.findByRole('img', { name: 'portrait.jpg' });
      const next = dialog.getByRole('button', { name: 'Next media' });
      await waitFor(() => expect(next).toHaveProperty('disabled', false));
      fireEvent.click(next);
      const neighbor = await dialog.findByRole('img', { name: 'neighbor.jpg' });
      stage = 'renewing';
      fireEvent.error(neighbor);
      if (failure === 'renewed photo fails') {
        await waitFor(() => expect(neighbor.getAttribute('src')).toContain('/renewing/'));
        fireEvent.error(neighbor);
      }
      await dialog.findByRole('button', { name: 'Retry media' });

      fireEvent.click(dialog.getByRole('button', { name: 'Previous media' }));
      expect(await dialog.findByRole('img', { name: 'portrait.jpg' })).toBeTruthy();
      await waitFor(() => expect(next).toHaveProperty('disabled', false));
      fireEvent.click(next);
      stage = 'retry';
      fireEvent.click(await dialog.findByRole('button', { name: 'Retry media' }));
      const recovered = await dialog.findByRole('img', { name: 'neighbor.jpg' });
      expect(recovered.getAttribute('src')).toBe(
        `/objects/retry/api/v1/media/messages/${source.id}/attachments/${NEIGHBOR_OCCURRENCE_ID}/thumbnail`,
      );
    } finally {
      owner.dispose();
    }
  },
);
