// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { LiveKitMedia } from './LiveKitMedia';

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
