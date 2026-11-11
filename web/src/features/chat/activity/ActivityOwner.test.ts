// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest';
import type { components } from '@/api/schema';
import { SessionOwner } from '@/features/auth/SessionOwner';
import { ActivityOwner } from './ActivityOwner';

const ORIGIN = 'http://localhost:8080';
const ACCOUNT: components['schemas']['AuthResponse'] = {
  csrf_token: 'session-csrf',
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'alice',
    display_name: 'Alice',
    biography: '',
    phone: null,
    email: null,
    is_operator: false,
    version: '1',
  },
  session: {
    id: '00000000-0000-4000-8000-000000000002',
    device_name: 'Browser',
    created_at: '2026-11-08T00:00:00Z',
    last_seen_at: '2026-11-08T00:00:00Z',
    expires_at: '2026-12-08T00:00:00Z',
    is_current: true,
  },
};
const FIRST_VIEW = {
  conversationId: 'first-conversation',
  peerId: 'first-peer',
  generation: '1',
};
const SECOND_VIEW = {
  conversationId: 'second-conversation',
  peerId: 'second-peer',
  generation: '1',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function openSession(fetch: (request: Request) => Promise<Response>) {
  const session = new SessionOwner({ baseUrl: ORIGIN, fetch });
  session.accept(ACCOUNT, { shouldBroadcast: false });
  const activity = new ActivityOwner({ session });
  const disconnect = activity.connect();

  return { activity, session, disconnect };
}

it('discards activity returned after the direct view or owning session changes', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const lookups = new Map<string, (response: Response) => void>();
  const { activity, session, disconnect } = openSession(async (request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/heartbeat')) {
      return new Response(null, { status: 204 });
    }

    return new Promise<Response>((resolve) => {
      lookups.set(path, resolve);
    });
  });
  try {
    activity.setView(FIRST_VIEW);
    await vi.waitFor(() => expect(lookups.has('/api/v1/activity/presence/first-peer')).toBe(true));
    activity.setView(SECOND_VIEW);
    await vi.waitFor(() => expect(lookups.has('/api/v1/activity/presence/second-peer')).toBe(true));

    const firstResponse = lookups.get('/api/v1/activity/presence/first-peer');
    firstResponse?.(Response.json({ online_for_ms: 30_000, typing_for_ms: 5_000 }));
    await vi.waitFor(() =>
      expect(activity.getSnapshot()).toEqual({
        view: SECOND_VIEW,
        isOnline: false,
        isTyping: false,
      }),
    );

    session.invalidate({ shouldBroadcast: false });
    const secondResponse = lookups.get('/api/v1/activity/presence/second-peer');
    secondResponse?.(Response.json({ online_for_ms: 30_000, typing_for_ms: 5_000 }));
    await vi.waitFor(() =>
      expect(activity.getSnapshot()).toEqual({ isOnline: false, isTyping: false }),
    );
  } finally {
    disconnect();
  }
});

it('expires missed stops and clears indicators when the tab becomes hidden', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const foreground = vi.fn();
  const { activity, disconnect } = openSession(async (request) => {
    if (request.method === 'POST') {
      foreground(await request.json());
      return new Response(null, { status: 204 });
    }

    return Response.json({ online_for_ms: 30_000, typing_for_ms: 6_000 });
  });
  try {
    activity.setView(FIRST_VIEW);
    await vi.advanceTimersByTimeAsync(0);
    expect(activity.getSnapshot()).toMatchObject({ isOnline: true, isTyping: true });

    await vi.advanceTimersByTimeAsync(6_000);
    expect(activity.getSnapshot()).toMatchObject({ isOnline: true, isTyping: false });

    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(activity.getSnapshot()).toMatchObject({ isOnline: false, isTyping: false });
    expect(foreground).toHaveBeenLastCalledWith(expect.objectContaining({ is_foreground: false }));

    foreground.mockClear();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(foreground).not.toHaveBeenCalled();
  } finally {
    disconnect();
  }
});

it('refreshes typing only on fresh edits and orders stop after the last edit', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const typingRequests: { sequence: string; is_typing: boolean }[] = [];
  const { activity, disconnect } = openSession(async (request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/typing')) {
      typingRequests.push(await request.json());
    }
    if (request.method === 'POST') {
      return new Response(null, { status: 204 });
    }

    return Response.json({ online_for_ms: 0, typing_for_ms: 0 });
  });
  try {
    activity.setView(FIRST_VIEW);
    await vi.advanceTimersByTimeAsync(0);
    activity.recordComposerChange({ isTyping: true });
    activity.recordComposerChange({ isTyping: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(typingRequests.map((request) => request.is_typing)).toEqual([true]);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(typingRequests).toHaveLength(1);
    activity.recordComposerChange({ isTyping: true });
    activity.recordComposerChange({ isTyping: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(typingRequests.map((request) => request.is_typing)).toEqual([true, true, false]);
    expect(Number(typingRequests[2].sequence)).toBeGreaterThan(Number(typingRequests[1].sequence));
  } finally {
    disconnect();
  }
});
