// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MediaSelection } from './uploadTransfer';
import { useVoiceRecorder } from './useVoiceRecorder';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

class RecordingFixture extends EventTarget {
  static isTypeSupported(): boolean {
    return true;
  }

  state = 'inactive';
  mimeType = 'audio/webm;codecs=opus';

  start(): void {
    this.state = 'recording';
  }

  pause(): void {
    this.state = 'paused';
    this.dispatchEvent(new Event('pause'));
  }

  resume(): void {
    this.state = 'recording';
    this.dispatchEvent(new Event('resume'));
  }

  requestData(): void {
    const blob = new Blob(['voice sample'], { type: this.mimeType });
    const event = Object.assign(new Event('dataavailable'), { data: blob });
    this.dispatchEvent(event);
  }

  stop(): void {
    this.state = 'inactive';
    this.requestData();
    this.dispatchEvent(new Event('stop'));
  }
}

function mockMicrophone() {
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] };
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal('MediaRecorder', RecordingFixture);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  return { getUserMedia, stopTrack, stream };
}

it('releases the microphone when a recording is cancelled', async () => {
  const { stopTrack } = mockMicrophone();
  const onFinish = vi.fn();
  const { result } = renderHook(() => useVoiceRecorder(onFinish));

  await act(() => result.current.start());
  expect(result.current.isRecording).toBe(true);
  act(() => result.current.cancel());

  expect(stopTrack).toHaveBeenCalledOnce();
  expect(result.current.isRecording).toBe(false);
  expect(onFinish).not.toHaveBeenCalled();
});

it('previews a paused recording and excludes pauses from elapsed time', async () => {
  vi.useFakeTimers();
  const { stopTrack } = mockMicrophone();
  const onFinish = vi.fn();
  const { result } = renderHook(() => useVoiceRecorder(onFinish));

  await act(() => result.current.start());
  act(() => vi.advanceTimersByTime(1_000));
  act(() => result.current.pause());

  expect(result.current.isPaused).toBe(true);
  expect(result.current.preview?.size).toBeGreaterThan(0);
  const pausedAt = result.current.elapsedMs;
  expect(pausedAt).toBe(1_000);
  act(() => vi.advanceTimersByTime(4_000));
  expect(result.current.elapsedMs).toBe(pausedAt);
  expect(onFinish).not.toHaveBeenCalled();

  act(() => result.current.resume());
  expect(result.current.preview).toBeUndefined();
  act(() => vi.advanceTimersByTime(500));
  act(() => result.current.pause());
  expect(result.current.elapsedMs).toBe(1_500);
  await act(async () => result.current.send());

  expect(onFinish).toHaveBeenCalledOnce();
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(result.current.isActive).toBe(false);
});

it('keeps a rejected recording and prevents duplicate sends', async () => {
  mockMicrophone();
  let resolveFirstSend: (success: boolean) => void = () => undefined;
  const firstSend = new Promise<boolean>((resolve) => {
    resolveFirstSend = resolve;
  });
  const onFinish = vi
    .fn<(selection: MediaSelection) => Promise<boolean>>()
    .mockReturnValueOnce(firstSend)
    .mockResolvedValueOnce(true);
  const { result } = renderHook(() => useVoiceRecorder(onFinish));

  await act(() => result.current.start());
  act(() => {
    result.current.send();
    result.current.send();
  });
  expect(result.current.isSending).toBe(true);
  expect(onFinish).toHaveBeenCalledOnce();

  await act(async () => resolveFirstSend(false));
  expect(result.current.isActive).toBe(true);
  expect(result.current.preview).toBe(onFinish.mock.calls[0][0].blob);

  await act(async () => result.current.send());
  expect(onFinish).toHaveBeenCalledTimes(2);
  expect(onFinish.mock.calls[1][0]).toBe(onFinish.mock.calls[0][0]);
  expect(result.current.isActive).toBe(false);
});

it('stops at the active recording limit and waits for an explicit send', async () => {
  vi.useFakeTimers();
  const { stopTrack } = mockMicrophone();
  const onFinish = vi.fn();
  const { result } = renderHook(() => useVoiceRecorder(onFinish));
  const limit = 10 * 60 * 1000;
  const beforeLimit = limit - 1_000;

  await act(() => result.current.start());
  act(() => vi.advanceTimersByTime(beforeLimit));
  act(() => result.current.pause());
  act(() => vi.advanceTimersByTime(2_000));
  expect(result.current.elapsedMs).toBe(beforeLimit);
  expect(stopTrack).not.toHaveBeenCalled();

  act(() => result.current.resume());
  act(() => vi.advanceTimersByTime(1_000));
  expect(result.current.elapsedMs).toBe(limit);
  expect(result.current.isRecording).toBe(false);
  expect(result.current.canSend).toBe(true);
  expect(result.current.preview?.size).toBeGreaterThan(0);
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(onFinish).not.toHaveBeenCalled();

  await act(async () => result.current.send());
  expect(onFinish).toHaveBeenCalledOnce();
});

it('releases a microphone granted after the recording was cancelled', async () => {
  const { getUserMedia, stopTrack, stream } = mockMicrophone();
  let grantMicrophone: (granted: typeof stream) => void = () => undefined;
  const microphone = new Promise<typeof stream>((resolve) => {
    grantMicrophone = resolve;
  });
  getUserMedia.mockReturnValueOnce(microphone);
  const onFinish = vi.fn();
  const { result } = renderHook(() => useVoiceRecorder(onFinish));

  act(() => void result.current.start());
  expect(result.current.isRequesting).toBe(true);
  act(() => result.current.cancel());
  await act(async () => grantMicrophone(stream));

  expect(stopTrack).toHaveBeenCalledOnce();
  expect(result.current.isActive).toBe(false);
  expect(onFinish).not.toHaveBeenCalled();
});
