// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MediaSelection } from './uploadTransfer';
import { VoiceRecordingBar } from './VoiceRecordingBar';
import { useVoiceRecorder } from './useVoiceRecorder';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

function mockMicrophoneLevels() {
  let sample = 128;
  class AudioContextFixture {
    createAnalyser() {
      return {
        fftSize: 4,
        getByteTimeDomainData(samples: Uint8Array) {
          samples.fill(sample);
        },
        disconnect() {},
      };
    }

    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }

    async resume() {}
    async close() {}
  }

  vi.stubGlobal('AudioContext', AudioContextFixture);
  return (nextSample: number) => {
    sample = nextSample;
  };
}

function renderRecorder() {
  const previewUrl = 'blob:https://example.test/recording';
  const revokeObjectURL = vi.fn();
  class PreviewURL extends URL {
    static createObjectURL = () => previewUrl;
    static revokeObjectURL = revokeObjectURL;
  }
  vi.stubGlobal('URL', PreviewURL);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);

  function Recorder() {
    const recorder = useVoiceRecorder(() => undefined);
    if (recorder.isActive) {
      return <VoiceRecordingBar recorder={recorder} />;
    }

    return <button onClick={() => void recorder.start()}>Record</button>;
  }

  return { ...render(<Recorder />), previewUrl, revokeObjectURL };
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

it('keeps peaks from the beginning of a long take and across capture pauses', async () => {
  vi.useFakeTimers();
  mockMicrophone();
  const setMicrophoneLevel = mockMicrophoneLevels();
  const { result } = renderHook(() => useVoiceRecorder(() => undefined));

  setMicrophoneLevel(160);
  await act(() => result.current.start());
  act(() => vi.advanceTimersByTime(400));
  setMicrophoneLevel(128);
  act(() => vi.advanceTimersByTime(3_600));
  act(() => result.current.pause());

  expect(result.current.waveform.every((level) => level === 0)).toBe(true);
  const firstTakeLength = result.current.previewPeaks?.length ?? 0;
  expect(firstTakeLength).toBeGreaterThan(result.current.waveform.length);
  expect(result.current.previewPeaks?.[0]).toBe(1);
  expect(result.current.previewPeaks?.at(-1)).toBe(0);

  act(() => vi.advanceTimersByTime(3_000));
  act(() => result.current.resume());
  expect(result.current.previewPeaks).toBeUndefined();
  setMicrophoneLevel(144);
  act(() => vi.advanceTimersByTime(400));
  act(() => result.current.pause());

  expect(result.current.previewPeaks?.length).toBe(firstTakeLength + 5);
  expect(result.current.previewPeaks?.[0]).toBe(1);
  expect(result.current.previewPeaks?.at(-1)).toBe(0.625);
});

it('shows preview playback time and seeks the underlying paused take', async () => {
  vi.useFakeTimers();
  mockMicrophone();
  const { container } = renderRecorder();

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Record' })));
  act(() => vi.advanceTimersByTime(4_000));
  fireEvent.click(screen.getByRole('button', { name: 'Pause recording' }));
  const audio = container.querySelector('audio')!;
  const seekControl = screen.getByRole('slider', { name: 'Recording preview playback position' });
  expect(seekControl).toHaveProperty('max', '4');

  fireEvent.play(audio);
  audio.currentTime = 1.25;
  fireEvent.timeUpdate(audio);
  expect(screen.getByText('0:01,25')).toBeTruthy();
  expect(seekControl).toHaveProperty('value', '1.25');

  fireEvent.change(seekControl, { target: { value: '2.5' } });
  expect(audio.currentTime).toBe(2.5);
  expect(screen.getByText('0:02,50')).toBeTruthy();

  fireEvent.pause(audio);
  fireEvent.change(seekControl, { target: { value: '0' } });
  expect(screen.getByText('0:00,00')).toBeTruthy();

  fireEvent.ended(audio);
  expect(seekControl).toHaveProperty('value', '0');
  expect(screen.getByText('0:04,00')).toBeTruthy();
});

it('abandons the playing preview and its URL when the recording is cancelled', async () => {
  vi.useFakeTimers();
  const { stopTrack } = mockMicrophone();
  const { container, previewUrl, revokeObjectURL } = renderRecorder();

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Record' })));
  act(() => vi.advanceTimersByTime(1_000));
  fireEvent.click(screen.getByRole('button', { name: 'Pause recording' }));

  const audio = container.querySelector('audio')!;
  let isPaused = false;
  vi.spyOn(audio, 'paused', 'get').mockImplementation(() => isPaused);
  vi.spyOn(audio, 'pause').mockImplementation(() => {
    isPaused = true;
  });
  fireEvent.play(audio);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel recording' }));

  expect(audio.paused).toBe(true);
  expect(audio.hasAttribute('src')).toBe(false);
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(previewUrl);
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(screen.queryByRole('group', { name: 'Voice recording controls' })).toBeNull();
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
