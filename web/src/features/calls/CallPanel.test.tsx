// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
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

const disconnects: (() => void)[] = [];

function setup(initialCall: CallView, options: { canOwnTab?: boolean } = {}) {
  let currentCall: CallView | null = initialCall;
  const transport: CallTransport = {
    current: async () => currentCall,
    start: async () => incoming,
    command: async () => connecting,
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
        events.onVideo([{ id: 'peer', stream: cameraStream, isLocal: false }]);
      },
      dispose: () => undefined,
      setCamera: async () => undefined,
      setMuted: async () => undefined,
      selectDevice: async () => undefined,
      listDevices: async () => [],
      playAudio: async () => undefined,
    }),
  });

  disconnects.push(owner.connect());
  const view = render(<CallPanel owner={owner} isChatOpen />);

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

afterEach(() => {
  cleanup();
  for (const disconnect of disconnects.splice(0)) {
    disconnect();
  }
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
  expect(screen.queryByRole('button', { name: 'Mute' })).toBeNull();
  expect(view.container.querySelector('video')).toBe(camera);
  expect(camera.srcObject).toBe(cameraStream);

  fireEvent.click(restore);
  expect(document.activeElement).toBe(collapse);
  expect(collapse.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('button', { name: 'Mute' })).toBeTruthy();
  expect(screen.getByLabelText('Peer camera')).toBe(camera);
});
