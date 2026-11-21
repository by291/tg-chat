import { describe, expect, it, vi } from 'vitest';
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
  it('preserves admitted contact changes when an older bootstrap completes', async () => {
    let releaseBootstrap: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      releaseBootstrap = resolve;
    });
    let rejectRemoval!: (response: Response) => void;
    const removal = new Promise<Response>((resolve) => {
      rejectRemoval = resolve;
    });
    const methods: string[] = [];
    const owner = new SessionOwner({
      baseUrl: ORIGIN,
      fetch: async (request) => {
        if (request.url.endsWith('/bootstrap')) {
          return pending;
        }
        methods.push(request.method);
        const isFirstRemoval = request.method === 'DELETE' && methods.length === 2;
        return isFirstRemoval ? removal : new Response(null, { status: 204 });
      },
    });
    owner.accept(SESSION, { shouldBroadcast: false });

    const bootstrapping = owner.loadChatBootstrap();
    // prettier-ignore
    await owner.setRelationship({
      kind: 'contacts',
      id: 'new-peer',
      shouldInclude: true,
    });
    releaseBootstrap(Response.json({ contacts: [{ id: 'earlier-peer' }], blocks: [] }));
    await bootstrapping;
    expect(owner.getSnapshot().relationships?.contacts).toEqual(
      new Set(['new-peer', 'earlier-peer']),
    );

    // prettier-ignore
    const remove = {
      kind: 'contacts' as const,
      id: 'new-peer',
      shouldInclude: false,
    };
    const removalRejected = expect(owner.setRelationship(remove)).rejects.toThrow();
    const retry = owner.setRelationship(remove);
    await vi.waitFor(() => expect(methods).toEqual(['PUT', 'DELETE']));
    rejectRemoval(Response.json({ error: { message: 'Rejected' } }, { status: 403 }));
    await removalRejected;
    await retry;
    // prettier-ignore
    expect(methods).toEqual([
      'PUT',
      'DELETE',
      'DELETE',
    ]);
    expect(owner.getSnapshot().relationships?.contacts).toEqual(new Set(['earlier-peer']));
    owner.invalidate({ shouldBroadcast: false });
    expect(owner.getSnapshot().relationships).toBeUndefined();
  });

  it('rejects an old contact admission if the session ends during the request', async () => {
    let release: (response: Response) => void = () => {};
    const response = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const owner = new SessionOwner({ baseUrl: ORIGIN, fetch: async () => response });
    owner.accept(SESSION, { shouldBroadcast: false });
    // prettier-ignore
    const adding = owner.setRelationship({
      kind: 'contacts',
      id: 'old-peer',
      shouldInclude: true,
    });
    const rejection = expect(adding).rejects.toMatchObject({ name: 'AbortError' });

    owner.invalidate({ shouldBroadcast: false });
    release(new Response(null, { status: 204 }));
    await rejection;
    expect(owner.getSnapshot().relationships).toBeUndefined();
  });

  it('retains the newest account settings when an earlier refresh returns late', async () => {
    let releaseOld: (response: Response) => void = () => undefined;
    const oldResponse = new Promise<Response>((resolve) => {
      releaseOld = resolve;
    });
    let settingsRequests = 0;
    const owner = new SessionOwner({
      baseUrl: ORIGIN,
      fetch: async (request) => {
        if (request.url.endsWith('/auth/session')) {
          return Response.json(SESSION);
        }
        settingsRequests += 1;
        return settingsRequests === 1
          ? oldResponse
          : Response.json({ version: '3', sticker_pack_ids: ['latest'] });
      },
    });
    owner.accept(SESSION, { shouldBroadcast: false });
    const older = owner.refreshAccountSettings('2');
    await owner.refreshAccountSettings('3');

    releaseOld(Response.json({ version: '2', sticker_pack_ids: ['old'] }));
    await older;

    expect(owner.getSnapshot().preferences?.version).toBe('3');
    expect(owner.getSnapshot().preferences?.sticker_pack_ids).toEqual(['latest']);
  });

  it('keeps saved profile fields when an earlier session refresh returns late', async () => {
    let resolveResponse: (response: Response) => void = () => undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const owner = new SessionOwner({
      baseUrl: ORIGIN,
      fetch: async () => pendingResponse,
    });
    owner.accept(SESSION, { shouldBroadcast: false });
    const pending = owner.refresh();
    owner.replaceProfile({
      ...SESSION.user,
      display_name: 'Saved name',
      version: '2',
    });

    resolveResponse(Response.json(SESSION));
    await pending;

    expect(owner.getSnapshot().auth?.user.display_name).toBe('Saved name');
    expect(owner.getSnapshot().auth?.user.version).toBe('2');
  });

  it('compares profile versions exactly and never carries them into another account', () => {
    const owner = new SessionOwner({ baseUrl: ORIGIN });
    owner.accept(SESSION, { shouldBroadcast: false });
    const latest = {
      ...SESSION.user,
      display_name: 'Latest name',
      version: '9007199254740993',
    };
    owner.replaceProfile(latest);
    owner.replaceProfile({
      ...SESSION.user,
      display_name: 'Earlier name',
      version: '9007199254740992',
    });
    expect(owner.getSnapshot().auth?.user).toEqual(latest);

    owner.accept({ ...SESSION, session: { ...SESSION.session, id: 'rotated-session' } });
    expect(owner.getSnapshot().auth?.user).toEqual(latest);
    owner.accept({
      ...SESSION,
      user: {
        ...SESSION.user,
        id: 'another-account',
        username: 'bobby',
      },
    });
    expect(owner.getSnapshot().auth?.user.username).toBe('bobby');
    expect(owner.getSnapshot().auth?.user.version).toBe('1');
  });

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
