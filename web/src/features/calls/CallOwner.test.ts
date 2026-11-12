// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallOwner } from './CallOwner';
import type { CallView, CallMedia, CallTransport, CallCredentials } from './callModels';

const incoming: CallView = {
  id: 'call',
  conversation_id: 'conversation',
  peer_display_name: 'Casey',
  peer_id: 'casey',
  direction: 'incoming',
  mode: 'voice',
  phase: 'ringing',
  revision: '1',
  allowed_actions: ['accept', 'decline'],
  is_room_ready: false,
  reconnect_deadline: null,
};

const connecting: CallView = {
  ...incoming,
  phase: 'connecting',
  revision: '2',
  allowed_actions: ['hangup', 'media_permission_denied'],
  is_room_ready: true,
};

const cleanups: (() => void)[] = [];

function deferred<Value>() {
  let finish: (value: Value) => void = () => {
    throw new Error('The deferred result was not initialized.');
  };
  const promise = new Promise<Value>((resolve) => {
    finish = resolve;
  });
  return { promise, resolve: finish };
}

function setup(options: { transport?: Partial<CallTransport>; tabGrant?: Promise<void> } = {}) {
  let ownsSession = true;
  let onSessionChange = () => {};
  let current: CallView | null = incoming;
  const transport: CallTransport = {
    current: async () => current,
    start: async () => incoming,
    command: async () => connecting,
    outcome: async () => null,
    credentials: async () => ({
      url: 'wss://call.test',
      token: 'secret',
      expires_at: '2026-11-12T12:00:00Z',
    }),
    ...options.transport,
  };
  const join = vi.fn<CallMedia['join']>().mockResolvedValue(undefined);
  const dispose = vi.fn();
  const media: CallMedia = {
    prepare: async () => {},
    join,
    dispose,
    setCamera: async () => {
      throw new DOMException('Permission denied.', 'NotAllowedError');
    },
    setMuted: async () => {},
    selectDevice: async () => {},
    listDevices: async () => [],
    playAudio: async () => {},
  };

  const owner = new CallOwner({
    transport,
    getSession: () => (ownsSession ? { revision: 1, id: 'session' } : undefined),
    subscribeSession: (listener) => {
      onSessionChange = listener;
      return () => {};
    },
    createMedia: () => media,
    ownTab: async ({ activate }) => {
      if (options.tabGrant) {
        await options.tabGrant;
      }
      await activate();
    },
  });
  cleanups.push(owner.connect());

  return {
    owner,
    join,
    dispose,
    logout() {
      ownsSession = false;
      onSessionChange();
    },
    replaceCurrent(call: CallView | null) {
      current = call;
    },
  };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

describe('browser call ownership', () => {
  it('dismisses ringing when a different recipient session wins', async () => {
    const { owner, replaceCurrent } = setup();
    await owner.refresh();
    expect(owner.getSnapshot().call?.phase).toBe('ringing');

    replaceCurrent(null);
    await owner.refresh();
    expect(owner.getSnapshot().call).toBeUndefined();
  });

  it('shares one snapshot request between duplicate hints', async () => {
    const reply = deferred<CallView>();
    const current = vi.fn(() => reply.promise);
    const { owner } = setup({ transport: { current } });
    const first = owner.refresh();
    const second = owner.refresh();
    expect(current).toHaveBeenCalledTimes(1);
    reply.resolve(incoming);
    await Promise.all([first, second]);
    expect(owner.getSnapshot().call?.phase).toBe('ringing');
  });

  it('releases media and ignores a credential response that arrives after logout', async () => {
    const reply = deferred<CallCredentials>();
    const credentials = vi.fn(() => reply.promise);
    const { owner, logout, join, dispose } = setup({
      transport: { current: async () => connecting, credentials },
    });
    await owner.refresh();
    const activation = owner.activateMedia();
    await vi.waitFor(() => expect(credentials).toHaveBeenCalledOnce());
    logout();
    reply.resolve({
      url: 'wss://call.test',
      token: 'secret',
      expires_at: '2026-11-12T12:00:00Z',
    });
    await activation;

    expect(owner.getSnapshot().call).toBeUndefined();
    expect(join).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('keeps the audio connection when optional camera permission fails', async () => {
    const { owner, join, dispose } = setup({ transport: { current: async () => connecting } });
    await owner.refresh();
    await owner.activateMedia();
    expect(join).toHaveBeenCalledOnce();

    await owner.toggleCamera();

    expect(owner.getSnapshot()).toMatchObject({ mediaStatus: 'connected', isCameraOn: false });
    expect(owner.getSnapshot().error).toMatch(/camera/i);
    expect(dispose).not.toHaveBeenCalled();
  });
});

it('does not join media from a tab waiting for the shared call lock', async () => {
  const lock = deferred<void>();
  const first = setup({ transport: { current: async () => connecting } });
  // Contention is modeled by withholding the Web Lock grant from the second tab.
  const second = setup({
    transport: { current: async () => connecting },
    tabGrant: lock.promise,
  });

  await first.owner.refresh();
  await second.owner.refresh();
  await second.owner.activateMedia();
  expect(second.join).not.toHaveBeenCalled();

  first.logout();
  lock.resolve(undefined);
  await vi.waitFor(() => expect(second.owner.getSnapshot().ownsTab).toBe(true));
  await second.owner.activateMedia();
  expect(second.join).toHaveBeenCalledOnce();
});

it('releases the lock on pagehide and waits for pageshow to restore the call', async () => {
  const { owner } = setup({ transport: { current: async () => connecting } });
  await owner.refresh();
  expect(owner.getSnapshot().ownsTab).toBe(true);

  window.dispatchEvent(new Event('pagehide'));
  await owner.refresh();
  expect(owner.getSnapshot().call).toBeUndefined();

  window.dispatchEvent(new Event('pageshow'));
  await owner.refresh();
  expect(owner.getSnapshot().call?.id).toBe(connecting.id);
});

it('stops local capture when Hang up is requested even before the server responds', async () => {
  const response = deferred<CallView>();
  const { owner, dispose } = setup({
    transport: {
      current: async () => connecting,
      command: () => response.promise,
    },
  });
  await owner.refresh();
  await owner.activateMedia();

  const hangup = owner.command('hangup');
  expect(dispose).toHaveBeenCalledOnce();
  response.resolve({ ...connecting, phase: 'ended', revision: '3', allowed_actions: [] });
  await hangup;
});

it('releases media before reading the outcome of an expired setup', async () => {
  const result = deferred<'transport_failed'>();
  const { owner, dispose, replaceCurrent } = setup({
    transport: { outcome: () => result.promise },
  });
  await owner.refresh();
  replaceCurrent(connecting);
  await owner.refresh();
  await owner.activateMedia();

  replaceCurrent(null);
  await owner.refresh();
  expect(owner.getSnapshot().call).toBeUndefined();
  expect(dispose).toHaveBeenCalledOnce();

  result.resolve('transport_failed');
  await vi.waitFor(() => expect(owner.getSnapshot().error).toMatch(/timed out/i));
});

it('ignores a delayed terminal outcome after a new call arrives', async () => {
  const result = deferred<'transport_failed'>();
  const outcome = vi.fn(() => result.promise);
  const { owner, replaceCurrent } = setup({ transport: { outcome } });
  await owner.refresh();
  replaceCurrent(connecting);
  await owner.refresh();

  replaceCurrent(null);
  await owner.refresh();
  expect(outcome).toHaveBeenCalledOnce();

  replaceCurrent({ ...incoming, id: 'next-call' });
  await owner.refresh();
  result.resolve('transport_failed');
  await result.promise;

  expect(owner.getSnapshot().call?.id).toBe('next-call');
  expect(owner.getSnapshot().error).toBeUndefined();
});

it('reads the outcome once more when the worker has not recorded it yet', async () => {
  const outcome = vi.fn<CallTransport['outcome']>();
  outcome.mockResolvedValueOnce(null);
  outcome.mockResolvedValueOnce('transport_failed');
  const { owner, replaceCurrent } = setup({ transport: { outcome } });
  await owner.refresh();
  replaceCurrent(connecting);
  await owner.refresh();

  replaceCurrent(null);
  await owner.refresh();
  expect(owner.getSnapshot().error).toBeUndefined();

  await owner.refresh();
  await vi.waitFor(() => expect(owner.getSnapshot().error).toMatch(/timed out/i));

  await owner.refresh();
  expect(outcome).toHaveBeenCalledTimes(2);
});
