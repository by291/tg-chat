// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CallOwner } from './CallOwner';
import { CallPanel } from './CallPanel';
import type { CallMedia, CallTransport, CallView } from './callModels';

const incoming: CallView = {
  id: 'call',
  conversation_id: 'conversation',
  peer_display_name: 'Casey',
  peer_id: 'casey',
  direction: 'incoming',
  mode: 'video',
  phase: 'ringing',
  revision: '1',
  allowed_actions: ['accept', 'decline'],
  is_room_ready: false,
};

const connecting: CallView = {
  ...incoming,
  phase: 'connecting',
  revision: '2',
  allowed_actions: ['hangup', 'media_permission_denied'],
  is_room_ready: true,
};

const activeCall = {
  ...connecting,
  phase: 'active' as const,
  revision: '3',
  active_at: '2026-11-13T10:00:00Z',
};

const disconnects: (() => void)[] = [];
const playing = new Set<HTMLMediaElement>();

interface PanelTestOptions {
  canOwnTab?: boolean;
  devices?: MediaDeviceInfo[];
  selectDevice?: CallMedia['selectDevice'];
}

function setup(initialCall: CallView, options: PanelTestOptions = {}) {
  let currentCall: CallView | null = initialCall;
  const transport: CallTransport = {
    current: async () => currentCall,
    start: async () => incoming,
    command: async ({ action }) => {
      currentCall = action === 'hangup' ? { ...connecting, phase: 'ended' } : connecting;
      return currentCall;
    },
    outcome: async () => null,
    credentials: async () => ({
      url: 'wss://call.test',
      token: 'secret',
      expires_at: '2026-11-13T12:00:00Z',
    }),
  };

  const cameraStream = { id: 'peer-camera' } as MediaStream;
  const owner = new CallOwner({
    transport,
    getSession: () => ({ id: 'session', revision: 1 }),
    subscribeSession: () => () => undefined,
    ownTab: async ({ activate }) => {
      if (options.canOwnTab ?? true) {
        await activate();
      }
    },
    createMedia: (events): CallMedia => ({
      prepare: async () => undefined,
      join: async () => {
        events.onVideo([
          {
            id: 'peer',
            stream: cameraStream,
            isLocal: false,
            isMirrored: false,
          },
        ]);
      },
      dispose: () => undefined,
      setCamera: async () => undefined,
      setMuted: async () => undefined,
      selectDevice: options.selectDevice ?? (async () => undefined),
      listDevices: async () => options.devices ?? [],
      playAudio: async () => undefined,
    }),
  });

  disconnects.push(owner.connect());
  const view = render(<CallPanel owner={owner} />);

  return {
    view,
    owner,
    cameraStream,
    async updateCall(call: CallView | null) {
      currentCall = call;
      await act(async () => owner.refresh());
    },
  };
}

beforeEach(() => {
  // Motion restores the viewport after measuring auto height. jsdom has no scrolling viewport.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

  // jsdom does not decode audio. Track playback at the browser media boundary.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    playing.add(this);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    playing.delete(this);
  });
});

afterEach(() => {
  cleanup();
  for (const disconnect of disconnects.splice(0)) {
    disconnect();
  }
  playing.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('preserves the video node and keyboard focus when collapsing and restoring', async () => {
  const { view, owner, cameraStream } = setup(connecting);
  await act(async () => owner.refresh());
  fireEvent.click(screen.getByRole('button', { name: 'Enable microphone and camera' }));
  const camera = await screen.findByLabelText<HTMLVideoElement>('Peer camera');

  const collapse = screen.getByRole('button', { name: 'Collapse call panel' });
  collapse.focus();
  fireEvent.click(collapse);

  const restore = screen.getByRole('button', { name: 'Restore call panel' });
  expect(restore).toBe(document.activeElement);
  expect(restore.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
  expect(await screen.findByRole('button', { name: 'Unmute' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Hang up' })).toBeTruthy();
  expect(view.container.querySelector('video')).toBe(camera);
  expect(camera.srcObject).toBe(cameraStream);

  fireEvent.click(restore);
  expect(document.activeElement).toBe(collapse);
  expect(collapse.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('button', { name: 'Unmute' })).toBeTruthy();
  expect(screen.getByLabelText('Peer camera')).toBe(camera);

  fireEvent.click(collapse);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Hang up' })));
  expect(screen.queryByRole('region', { name: 'Call' })).toBeNull();
  expect(camera.srcObject).toBeNull();
});

it('counts from server activation in the compact panel and through reconnect', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T10:01:07Z'));
  const { owner, updateCall } = setup(connecting);
  await act(async () => owner.refresh());
  expect(screen.queryByRole('timer')).toBeNull();

  await updateCall(activeCall);
  fireEvent.click(screen.getByRole('button', { name: 'Collapse call panel' }));
  const timer = screen.getByRole('timer', { name: 'Call duration' });
  expect(timer.textContent).toBe('01:07');

  await updateCall({ ...activeCall, reconnect_deadline: '2026-11-13T10:01:30Z' });
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
  expect(timer.textContent).toBe('01:09');
});

it('plays a ringtone only in the owning tab and silences it once ringing ends', async () => {
  const waiting = setup(incoming, { canOwnTab: false });
  await act(async () => waiting.owner.refresh());
  expect(screen.getByText('Call is open in another tab.')).toBeTruthy();
  expect(playing.size).toBe(0);

  const ringing = setup(incoming);
  await act(async () => ringing.owner.refresh());
  expect(playing.size).toBe(1);
  const [ringtone] = playing;
  expect(ringtone.loop).toBe(true);

  await ringing.updateCall(connecting);
  expect(playing.size).toBe(0);

  const outgoing: CallView = {
    ...incoming,
    id: 'outgoing-call',
    direction: 'outgoing',
    allowed_actions: ['cancel'],
  };
  await ringing.updateCall(outgoing);
  expect(playing.size).toBe(1);
  const [ringback] = playing;
  expect(ringback.src).not.toBe(ringtone.src);

  ringing.view.unmount();
  expect(playing.size).toBe(0);
});

it('keeps the incoming controls available when the browser blocks the ringtone', async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
    new DOMException('Autoplay is blocked.', 'NotAllowedError'),
  );
  const { owner } = setup(incoming);
  await act(async () => owner.refresh());

  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Answer' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('withdraws a ringing action immediately when its server permission changes', async () => {
  const { owner, updateCall } = setup(incoming);
  await act(async () => owner.refresh());
  expect(screen.getByRole('button', { name: 'Answer' })).toBeTruthy();

  await updateCall({
    ...incoming,
    revision: '2',
    allowed_actions: ['decline'],
  });
  expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
});

it('restores compact chrome after leaving the call fullscreen', async () => {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  const { owner } = setup(connecting);
  await act(async () => owner.refresh());
  const panel = screen.getByRole('region', { name: 'Call' });
  let fullscreenElement: Element | null = null;

  function changeFullscreen(element: Element | null) {
    fullscreenElement = element;
    document.dispatchEvent(new Event('fullscreenchange'));
  }

  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  });
  panel.requestFullscreen = async () => changeFullscreen(panel);
  const previousExit = document.exitFullscreen;
  document.exitFullscreen = async () => changeFullscreen(null);

  try {
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
    expect(await screen.findByRole('button', { name: 'Exit fullscreen' })).toBeTruthy();
    await act(async () => changeFullscreen(null));
    // Native state can change before its queued fullscreenchange reaches React.
    fullscreenElement = panel;
    fireEvent.click(screen.getByRole('button', { name: 'Collapse call panel' }));
    expect(await screen.findByRole('button', { name: 'Restore call panel' })).toBeTruthy();
    expect(document.fullscreenElement).toBeNull();
  } finally {
    Reflect.deleteProperty(document, 'fullscreenElement');
    Reflect.deleteProperty(document, 'fullscreenEnabled');
    document.exitFullscreen = previousExit;
  }
});

it('keeps the current input and reports a refused switch from device settings', async () => {
  const { owner } = setup(connecting, {
    devices: [
      {
        deviceId: 'rear',
        label: 'Rear camera',
        kind: 'videoinput',
      } as MediaDeviceInfo,
    ],
    selectDevice: async () => {
      throw new DOMException('Permission denied.', 'NotAllowedError');
    },
  });
  await act(async () => owner.refresh());
  fireEvent.click(screen.getByRole('button', { name: 'Enable microphone and camera' }));
  await screen.findByLabelText('Peer camera');
  expect(screen.queryByRole('combobox', { name: 'Camera' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Device settings' }));
  const camera = screen.getByLabelText<HTMLSelectElement>('Camera');
  fireEvent.change(camera, { target: { value: 'rear' } });
  expect((await screen.findByRole('alert')).textContent).toContain('could not be used');
  expect(camera.value).toBe('');
});

it('opens expanded for fresh media consent when the same call is rediscovered', async () => {
  const { owner, updateCall } = setup(connecting);
  await act(async () => owner.refresh());
  fireEvent.click(screen.getByRole('button', { name: 'Collapse call panel' }));
  const previousHangup = screen.getByRole('button', { name: 'Hang up' });

  await updateCall(null);
  await updateCall(connecting);
  expect(screen.getByRole('button', { name: 'Enable microphone and camera' })).toBeTruthy();

  // Queued input on a departing control cannot end the newly admitted call.
  await act(async () => previousHangup.click());
  expect(screen.getByRole('button', { name: 'Enable microphone and camera' })).toBeTruthy();
});

it('keeps a rediscovered call expanded after an older native exit completes', async () => {
  const { owner, updateCall } = setup(connecting);
  await act(async () => owner.refresh());
  const panel = screen.getByRole('region', { name: 'Call' });
  let completeExit!: () => void;
  const previousExit = document.exitFullscreen;
  document.exitFullscreen = () =>
    new Promise<void>((resolve) => {
      completeExit = resolve;
    });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: panel });
  try {
    act(() => document.dispatchEvent(new Event('fullscreenchange')));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse call panel' }));
    await updateCall(null);
    await updateCall(connecting);
    await act(async () => completeExit());
    expect(screen.getByRole('button', { name: 'Enable microphone and camera' })).toBeTruthy();
  } finally {
    document.exitFullscreen = previousExit;
    Reflect.deleteProperty(document, 'fullscreenElement');
  }
});
