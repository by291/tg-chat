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

const outgoing: CallView = {
  ...incoming,
  direction: 'outgoing',
  allowed_actions: ['cancel'],
};

const outgoingConnecting: CallView = {
  ...connecting,
  direction: 'outgoing',
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

function setup(
  options: {
    transport?: Partial<CallTransport>;
    tabGrant?: Promise<void>;
    initialCall?: CallView | null;
  } = {},
) {
  let ownsSession = true;
  let onSessionChange = () => {};
  let current = options.initialCall === undefined ? incoming : options.initialCall;
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
  const prepare = vi.fn<CallMedia['prepare']>().mockResolvedValue(undefined);
  const dispose = vi.fn();
  const media: CallMedia = {
    prepare,
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
    prepare,
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
  it('connects after answering once the server grants this session the call', async () => {
    const result = deferred<CallView>();
    const { owner, prepare, replaceCurrent } = setup({
      transport: { command: () => result.promise },
    });
    await owner.refresh();

    const answer = owner.answer();
    expect(prepare).not.toHaveBeenCalled();

    const preparingRoom = { ...connecting, is_room_ready: false };
    replaceCurrent(preparingRoom);
    result.resolve(preparingRoom);
    await answer;
    await vi.waitFor(() => expect(owner.getSnapshot().mediaStatus).toBe('waiting'));

    replaceCurrent(connecting);
    await vi.waitFor(async () => {
      await owner.refresh();
      expect(owner.getSnapshot().call?.is_room_ready).toBe(true);
    });
    await vi.waitFor(() => expect(owner.getSnapshot().mediaStatus).toBe('connected'));
    expect(prepare).toHaveBeenCalledWith('voice');
  });

  it('never opens devices when another recipient session wins the answer', async () => {
    const result = deferred<CallView>();
    const { owner, prepare, replaceCurrent } = setup({
      transport: { command: () => result.promise },
    });
    await owner.refresh();

    const answer = owner.answer();
    replaceCurrent(null);
    result.resolve({ ...connecting, allowed_actions: [], is_room_ready: false });
    await answer;

    expect(owner.getSnapshot().call).toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('never opens devices when the answer result arrives after logout', async () => {
    const result = deferred<CallView>();
    const { owner, logout, prepare } = setup({
      transport: { command: () => result.promise },
    });
    await owner.refresh();

    const answer = owner.answer();
    logout();
    result.resolve(connecting);
    await answer;

    expect(owner.getSnapshot().call).toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('ignores an answer result for a different call', async () => {
    const { owner, prepare } = setup({
      transport: { command: async () => ({ ...connecting, id: 'different-call' }) },
    });
    await owner.refresh();

    await owner.answer();

    expect(owner.getSnapshot().call?.id).toBe(incoming.id);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('connects an explicitly started call after acceptance and tab ownership', async () => {
    const lease = deferred<void>();
    const { owner, prepare, replaceCurrent } = setup({
      transport: { start: async () => outgoing },
      tabGrant: lease.promise,
      initialCall: null,
    });
    await owner.refresh();

    replaceCurrent(outgoing);
    await owner.start({ conversationId: outgoing.conversation_id, mode: outgoing.mode });
    expect(prepare).not.toHaveBeenCalled();

    replaceCurrent(outgoingConnecting);
    await vi.waitFor(async () => {
      await owner.refresh();
      expect(owner.getSnapshot().call?.phase).toBe('connecting');
    });
    expect(prepare).not.toHaveBeenCalled();

    lease.resolve(undefined);
    await vi.waitFor(() => expect(owner.getSnapshot().mediaStatus).toBe('connected'));
    expect(prepare).toHaveBeenCalledOnce();
  });

  it('does not open devices if the peer answers while the caller is canceling', async () => {
    const result = deferred<CallView>();
    const { owner, prepare, replaceCurrent } = setup({
      transport: { start: async () => outgoing, command: () => result.promise },
      initialCall: null,
    });
    await owner.refresh();
    replaceCurrent(outgoing);
    await owner.start({ conversationId: outgoing.conversation_id, mode: outgoing.mode });
    expect(owner.getSnapshot().ownsTab).toBe(true);

    const cancel = owner.command('cancel');
    replaceCurrent(outgoingConnecting);
    result.resolve(outgoingConnecting);
    await cancel;

    expect(owner.getSnapshot().call?.phase).toBe('connecting');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('requires explicit rejoin after an automatic media join fails', async () => {
    const { owner, join, prepare, dispose, replaceCurrent } = setup();
    join.mockRejectedValueOnce(new Error('The connection failed.'));
    await owner.refresh();

    replaceCurrent(connecting);
    await owner.answer();
    await vi.waitFor(() => expect(owner.getSnapshot().error).toMatch(/joining/i));
    expect(dispose).toHaveBeenCalledOnce();

    await owner.refresh();
    expect(owner.getSnapshot().mediaStatus).toBe('idle');
    expect(prepare).toHaveBeenCalledOnce();

    await owner.activateMedia();
    expect(owner.getSnapshot().mediaStatus).toBe('connected');
  });

  it('does not display a device error after logout during the failure report', async () => {
    const result = deferred<CallView>();
    const command = vi.fn<CallTransport['command']>();
    command.mockResolvedValueOnce(connecting);
    command.mockReturnValueOnce(result.promise);
    const { owner, prepare, logout, replaceCurrent } = setup({ transport: { command } });
    prepare.mockRejectedValueOnce(new DOMException('Permission denied.', 'NotAllowedError'));
    await owner.refresh();

    replaceCurrent(connecting);
    await owner.answer();
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2));
    expect(command.mock.calls[1]?.[0].action).toBe('media_permission_denied');

    logout();
    result.resolve({
      ...connecting,
      phase: 'ended',
      revision: '3',
      allowed_actions: [],
      end_reason: 'permission_denied',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(owner.getSnapshot().error).toBeUndefined();
  });

  it('requires explicit rejoin for an outgoing call restored from the server', async () => {
    const { owner, prepare } = setup({
      transport: { current: async () => outgoingConnecting },
    });
    await owner.refresh();

    expect(owner.getSnapshot().mediaStatus).toBe('idle');
    expect(prepare).not.toHaveBeenCalled();

    await owner.activateMedia();
    expect(owner.getSnapshot().mediaStatus).toBe('connected');
  });

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
