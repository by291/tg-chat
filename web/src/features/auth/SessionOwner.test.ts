import { describe, expect, it } from 'vitest';
import type { components } from '@/api/schema';
import { SessionOwner } from './SessionOwner';

type AuthResponse = components['schemas']['AuthResponse'];

const ORIGIN = 'http://localhost:8080';
const SESSION: AuthResponse = {
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

const LOGIN = {
  username: 'alice',
  password: 'a complete password phrase',
  device_name: 'Browser',
};

describe('SessionOwner', () => {
  it('discards a late session response after local ownership is invalidated', async () => {
    let resolveResponse: (response: Response) => void = () => undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const owner = new SessionOwner({
      baseUrl: ORIGIN,
      fetch: async () => pendingResponse,
    });

    const pending = owner.refresh();
    owner.invalidate();
    resolveResponse(Response.json(SESSION));
    await pending;

    expect(owner.getSnapshot().auth).toBeNull();
  });

  it('attaches session-bound CSRF to logout and clears all private ownership afterwards', async () => {
    let logoutRequest: Request | undefined;
    const owner = new SessionOwner({
      baseUrl: ORIGIN,
      fetch: async (request: Request) => {
        if (request.url.endsWith('/auth/login')) {
          return Response.json(SESSION);
        }
        logoutRequest = request;
        return new Response(null, { status: 204 });
      },
    });
    await owner.login(LOGIN);
    expect(owner.getSnapshot().auth?.user.username).toBe('alice');
    await owner.logout();

    expect(logoutRequest?.headers.get('x-csrf-token')).toBe(SESSION.csrf_token);
    expect(logoutRequest?.headers.get('x-tg-chat-request')).toBe('1');
    expect(logoutRequest?.credentials).toBe('include');
    expect(owner.getSnapshot().auth).toBeNull();
  });

  it('does not log out a valid account when recent password proof is incorrect', async () => {
    const owner = new SessionOwner({
      baseUrl: ORIGIN,
      fetch: async (request: Request) => {
        if (request.url.endsWith('/auth/login')) {
          return Response.json(SESSION);
        }
        return Response.json(
          {
            error: {
              code: 'invalid_credentials',
              message: 'The username or password is incorrect.',
              request_id: 'request-id',
            },
          },
          { status: 401 },
        );
      },
    });
    await owner.login(LOGIN);
    await expect(
      owner.client.POST('/api/v1/auth/reauthenticate', {
        body: { password: 'incorrect password' },
      }),
    ).rejects.toThrow('The username or password is incorrect.');

    expect(owner.getSnapshot().auth?.user.username).toBe('alice');
  });

  it('invalidates private state when the server rejects a revoked session', async () => {
    const owner = new SessionOwner({
      baseUrl: ORIGIN,
      fetch: async (request: Request) => {
        if (request.url.endsWith('/auth/login')) {
          return Response.json(SESSION);
        }
        return Response.json(
          {
            error: {
              code: 'unauthenticated',
              message: 'A valid account session is required.',
              request_id: 'request-id',
            },
          },
          { status: 401 },
        );
      },
    });
    await owner.login(LOGIN);
    await expect(owner.client.GET('/api/v1/account/profile')).rejects.toThrow();

    expect(owner.getSnapshot().auth).toBeNull();
  });
});

it('does not restore private ownership when a response body finishes after logout', async () => {
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      bodyController = controller;
    },
  });
  const owner = new SessionOwner({
    baseUrl: ORIGIN,
    fetch: async () =>
      new Response(stream, {
        headers: { 'content-type': 'application/json' },
      }),
  });
  const pending = owner.refresh();
  await new Promise((resolve) => setTimeout(resolve, 0));
  owner.invalidate();
  bodyController?.enqueue(new TextEncoder().encode(JSON.stringify(SESSION)));
  bodyController?.close();
  await pending;

  expect(owner.getSnapshot().auth).toBeNull();
});
