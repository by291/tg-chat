// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { LiveKitMedia } from './LiveKitMedia';
import type { CallVideo } from './callModels';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('stops a microphone grant that arrives after local media is disposed', async () => {
  const stop = vi.fn();
  const stream = {
    getTracks: () => [{ stop }],
  };
  let resolveGrant: (value: typeof stream) => void = () => {
    throw new Error('The test grant was not initialized.');
  };
  const grant = new Promise<typeof stream>((resolve) => {
    resolveGrant = resolve;
  });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => grant } });
  const media = new LiveKitMedia({
    onVideo: () => {},
    onAudioBlocked: () => {},
    onStatus: () => {},
  });

  const preparation = media.prepare('voice');
  media.dispose();
  resolveGrant(stream);

  await expect(preparation).rejects.toHaveProperty('name', 'AbortError');
  expect(stop).toHaveBeenCalledOnce();
});

it.each([
  { facingMode: 'user', isMirrored: true },
  { facingMode: 'environment', isMirrored: false },
  { facingMode: undefined, isMirrored: false },
])('uses the captured camera direction for the $facingMode preview', async (direction) => {
  const microphone = { id: 'microphone', stop: () => {} };
  const camera = {
    id: 'camera',
    getSettings: () => ({ facingMode: direction.facingMode }),
    stop: () => {},
  };
  const capture = {
    getVideoTracks: () => [camera],
    getAudioTracks: () => [microphone],
    getTracks: () => [microphone, camera],
  };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => capture } });
  vi.stubGlobal('MediaStream', class {});
  let preview: CallVideo | undefined;
  const media = new LiveKitMedia({
    onVideo: (videos) => {
      preview = videos.find((video) => video.isLocal);
    },
    onAudioBlocked: () => {},
    onStatus: () => {},
  });

  await media.prepare('video');
  expect(preview?.isMirrored).toBe(direction.isMirrored);
  media.dispose();
});
