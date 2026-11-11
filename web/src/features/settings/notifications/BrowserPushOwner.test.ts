// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import type { components } from '@/api/schema';
import { SessionOwner } from '@/features/auth/SessionOwner';
import { BrowserPushOwner } from './BrowserPushOwner';
import {
  clearBrowserSubscription,
  readBrowserSubscription,
  saveBrowserSubscription,
} from './notificationBrowserState';
import { resolveNotificationTarget } from './notificationNavigation';

const ORIGIN = 'http://localhost:8080';
const SESSION_ID = '00000000-0000-4000-8000-000000000002';
const SUBSCRIPTION_ID = '00000000-0000-4000-8000-000000000003';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000004';
const AUTH: components['schemas']['AuthResponse'] = {
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
    id: SESSION_ID,
    device_name: 'Browser',
    created_at: '2026-11-08T00:00:00Z',
    last_seen_at: '2026-11-08T00:00:00Z',
    expires_at: '2026-12-08T00:00:00Z',
    is_current: true,
  },
};

function openSession(fetch: (request: Request) => Promise<Response>) {
  const session = new SessionOwner({ baseUrl: ORIGIN, fetch });
  session.accept(AUTH, { shouldBroadcast: false });

  return session;
}

function browserWithPermission(permission: NotificationPermission) {
  const unsubscribe = vi.fn(async () => true);
  const requestPermission = vi.fn(async () => 'granted');
  const browserSubscription = {
    unsubscribe,
    toJSON: () => ({
      endpoint: 'https://push.example/subscription',
      keys: { p256dh: 'public-key', auth: 'authentication-secret' },
    }),
  };
  const registration = {
    active: {},
    pushManager: {
      getSubscription: async () => null,
      subscribe: async () => browserSubscription,
    },
  };
  vi.stubGlobal('Notification', { permission, requestPermission });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: async () => undefined,
      register: async () => registration,
    },
  });

  return { requestPermission, unsubscribe };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await clearBrowserSubscription({ sessionId: SESSION_ID });
});

it('unsubscribes a browser endpoint when its registration reply outlives the session', async () => {
  let didStartRegistration = false;
  let finishRegistration: ((response: Response) => void) | undefined;
  const pending = new Promise<Response>((resolve) => {
    finishRegistration = resolve;
  });
  const session = openSession(async (request) => {
    if (request.method === 'PUT') {
      await request.json();
      didStartRegistration = true;
      return pending;
    }

    return Response.json({ available: true, vapid_public_key: 'BA' });
  });
  const { requestPermission, unsubscribe } = browserWithPermission('default');

  const owner = new BrowserPushOwner({ session });
  const disconnect = owner.connect();
  try {
    await vi.waitFor(() => expect(owner.getSnapshot().status).toBe('disabled'));
    expect(requestPermission).not.toHaveBeenCalled();
    const enabling = owner.enable();
    await vi.waitFor(() => expect(didStartRegistration).toBe(true));
    session.invalidate({ shouldBroadcast: false });
    finishRegistration?.(Response.json({ subscription_id: SUBSCRIPTION_ID }));
    await enabling;

    expect(await readBrowserSubscription()).toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledOnce();
  } finally {
    disconnect();
  }
});

it('resolves a click to the inbox when current history authorization denies it', async () => {
  await saveBrowserSubscription({ sessionId: SESSION_ID, subscriptionId: SUBSCRIPTION_ID });
  const session = openSession(async () =>
    Response.json(
      { error: { code: 'not_found', message: 'Unavailable', request_id: 'request-id' } },
      { status: 404 },
    ),
  );
  const result = await resolveNotificationTarget({
    target: {
      kind: 'conversation',
      conversationId: CONVERSATION_ID,
      subscriptionId: SUBSCRIPTION_ID,
    },
    session,
    chat: {
      catchUp: async () => undefined,
      getSnapshot: () => ({ conversations: [] }),
    },
  });

  expect(result).toBeUndefined();
});

it('keeps an enabled subscription when a previous capability refresh returns late', async () => {
  let finishRefresh: ((response: Response) => void) | undefined;
  const pending = new Promise<Response>((resolve) => {
    finishRefresh = resolve;
  });
  let capabilityReads = 0;
  const capability = { available: true, vapid_public_key: 'BA' };
  const session = openSession(async (request) => {
    if (request.method === 'PUT') {
      return Response.json({ subscription_id: SUBSCRIPTION_ID });
    }

    capabilityReads++;
    return capabilityReads === 1 ? Response.json(capability) : pending;
  });
  browserWithPermission('granted');
  const owner = new BrowserPushOwner({ session });
  const disconnect = owner.connect();
  try {
    await vi.waitFor(() => expect(owner.getSnapshot().status).toBe('disabled'));
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(capabilityReads).toBe(2));
    await owner.enable();
    expect(owner.getSnapshot().status).toBe('enabled');

    finishRefresh?.(Response.json(capability));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(owner.getSnapshot().status).toBe('enabled');
  } finally {
    disconnect();
  }
});
