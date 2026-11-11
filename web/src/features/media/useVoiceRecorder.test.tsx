// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useVoiceRecorder } from './useVoiceRecorder';

afterEach(() => vi.unstubAllGlobals());

class RecordingFixture extends EventTarget {
  static isTypeSupported(): boolean {
    return true;
  }

  state = 'inactive';

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    this.dispatchEvent(new Event('stop'));
  }
}

it('releases the microphone when a recording is cancelled', async () => {
  const stopTrack = vi.fn();
  const mediaDevices = {
    getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }),
  };
  vi.stubGlobal('MediaRecorder', RecordingFixture);
  vi.stubGlobal('navigator', { mediaDevices });
  const onFinish = vi.fn();
  const { result } = renderHook(() => useVoiceRecorder(onFinish));

  await act(() => result.current.start());
  expect(result.current.isRecording).toBe(true);
  act(() => result.current.cancel());

  expect(stopTrack).toHaveBeenCalled();
  expect(result.current.isRecording).toBe(false);
  expect(onFinish).not.toHaveBeenCalled();
});
