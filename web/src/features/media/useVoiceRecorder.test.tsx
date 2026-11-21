// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
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
    this.emitData(new Blob(['voice sample'], { type: this.mimeType }));
  }

  /** Deliver the recorded bytes through the same boundary as a native timeslice. */
  protected emitData(blob: Blob): void {
    const event = Object.assign(new Event('dataavailable'), { data: blob });
    this.dispatchEvent(event);
  }

  stop(): void {
    this.state = 'inactive';
    this.requestData();
    this.dispatchEvent(new Event('stop'));
  }
}

function mockMicrophone(recorder = RecordingFixture) {
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] };
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal('MediaRecorder', recorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  // prettier-ignore
  return {
    getUserMedia,
    stopTrack,
    stream,
  };
}

const FIXTURE_SAMPLE_RATE = 1000;
const SILENCE_SAMPLE = 128;

function decodeFixtureSamples(bytes: ArrayBuffer) {
  const samples = Float32Array.from(new Uint8Array(bytes), (sample) => {
    return (sample - SILENCE_SAMPLE) / SILENCE_SAMPLE;
  });
  return {
    length: samples.length,
    duration: samples.length / FIXTURE_SAMPLE_RATE,
    sampleRate: FIXTURE_SAMPLE_RATE,
    numberOfChannels: 1,
    getChannelData: () => samples,
  };
}

class QuietMeterFixture {
  createAnalyser() {
    return {
      fftSize: 2048,
      getByteTimeDomainData(samples: Uint8Array) {
        samples.fill(SILENCE_SAMPLE);
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

function mockRecordedAudio() {
  const decode = vi.fn(async (bytes: ArrayBuffer) => decodeFixtureSamples(bytes));
  let chunks: Uint8Array<ArrayBuffer>[] = [];
  let capture: FixtureRecorder;
  class FixtureRecorder extends RecordingFixture {
    constructor() {
      super();
      capture = this;
    }

    /** Emit recorded samples independently of the composer's live meter timer. */
    requestData() {
      this.emitData(new Blob(chunks, { type: this.mimeType }));
      chunks = [];
    }
  }

  mockMicrophone(FixtureRecorder);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('AudioContext', QuietMeterFixture);
  vi.stubGlobal(
    'OfflineAudioContext',
    class {
      decodeAudioData = decode;
    },
  );

  function recordSamples({
    durationMs,
    pulseAtMs,
    pulse,
  }: {
    durationMs: number;
    pulseAtMs: number;
    pulse: number;
  }) {
    if (capture.state !== 'recording') {
      return;
    }

    const frames = new Uint8Array(durationMs).fill(SILENCE_SAMPLE);
    frames[pulseAtMs] = pulse;
    chunks.push(frames);
  }

  // prettier-ignore
  return {
    decode,
    recordSamples,
    stopCapture: () => capture.stop(),
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

  // prettier-ignore
  return {
    ...render(<Recorder />),
    previewUrl,
    revokeObjectURL,
  };
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

it('places short pulses at their recorded times even between live meter updates', async () => {
  vi.useFakeTimers();
  const { recordSamples } = mockRecordedAudio();
  const { result } = renderHook(() => useVoiceRecorder(() => undefined));

  await act(() => result.current.start());
  // The pulse falls after the 1120ms tick and before the 1200ms meter window.
  // prettier-ignore
  recordSamples({
    durationMs: 2400,
    pulseAtMs: 1150,
    pulse: 224,
  });
  act(() => vi.advanceTimersByTime(2_400));
  await act(async () => result.current.pause());

  const firstWaveform = result.current.previewPeaks ?? [];
  expect(result.current.waveform.every((level) => level === 0)).toBe(true);
  expect(firstWaveform).toContain(0.75);
  expect(firstWaveform).toContain(0);
  expect(firstWaveform.indexOf(0.75) / firstWaveform.length).toBeCloseTo(0.479, 1);

  // Audio from a paused interval has no place in the recording or its waveform.
  // prettier-ignore
  recordSamples({
    durationMs: 3000,
    pulseAtMs: 1000,
    pulse: 255,
  });
  act(() => vi.advanceTimersByTime(3_000));
  act(() => result.current.resume());
  expect(result.current.previewPeaks).toBeUndefined();

  // The resumed audio arrives before the UI executes another metering callback.
  // prettier-ignore
  recordSamples({
    durationMs: 800,
    pulseAtMs: 140,
    pulse: 192,
  });
  act(() => vi.advanceTimersByTime(800));
  await act(async () => result.current.pause());

  const fullWaveform = result.current.previewPeaks ?? [];
  expect(fullWaveform).toContain(0.75);
  expect(fullWaveform).toContain(0.5);
  expect(fullWaveform).not.toContain(127 / 128);
  expect(fullWaveform.indexOf(0.75) / fullWaveform.length).toBeCloseTo(0.359, 1);
  expect(fullWaveform.indexOf(0.5) / fullWaveform.length).toBeCloseTo(0.794, 1);
});

it('keeps an obsolete decode out of a newer paused take', async () => {
  vi.useFakeTimers();
  const { decode, recordSamples } = mockRecordedAudio();
  let finishPrevious = () => {};
  let finishCurrent = () => {};
  decode.mockImplementationOnce(
    (bytes) =>
      new Promise((resolve) => {
        finishPrevious = () => resolve(decodeFixtureSamples(bytes));
      }),
  );
  decode.mockImplementationOnce(
    (bytes) =>
      new Promise((resolve) => {
        finishCurrent = () => resolve(decodeFixtureSamples(bytes));
      }),
  );
  const { result } = renderHook(() => useVoiceRecorder(() => undefined));

  await act(() => result.current.start());
  // prettier-ignore
  recordSamples({
    durationMs: 100,
    pulseAtMs: 35,
    pulse: 224,
  });
  await act(async () => result.current.pause());
  act(() => result.current.cancel());
  await act(() => result.current.start());
  // prettier-ignore
  recordSamples({
    durationMs: 100,
    pulseAtMs: 70,
    pulse: 192,
  });
  await act(async () => result.current.pause());
  await act(async () => finishPrevious());
  expect(result.current.previewPeaks).toBeUndefined();

  await act(async () => finishCurrent());
  expect(result.current.previewPeaks).toContain(0.5);
  expect(result.current.previewPeaks).not.toContain(0.75);
});

it.each(['pending', 'rejected'])(
  'sends the original bytes when waveform decoding is %s',
  async (state) => {
    const { decode, recordSamples } = mockRecordedAudio();
    let failDecode = () => {};
    decode.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failDecode = () => reject(new Error('Preview codec unavailable'));
        }),
    );
    const finish = vi.fn(async (_selection: MediaSelection) => true);
    const { result } = renderHook(() => useVoiceRecorder(finish));

    await act(() => result.current.start());
    // prettier-ignore
    recordSamples({
    durationMs: 100,
    pulseAtMs: 70,
    pulse: 192,
  });
    await act(async () => result.current.pause());
    const take = result.current.preview;
    expect(take?.size).toBe(100);

    if (state === 'rejected') {
      await act(async () => failDecode());
    }
    expect(result.current.isPaused).toBe(true);
    expect(result.current.canPause).toBe(true);
    expect(result.current.canSend).toBe(true);
    expect(result.current.previewPeaks).toBeUndefined();

    await act(async () => result.current.send());
    const submittedBytes = await finish.mock.calls[0][0].blob.arrayBuffer();
    expect(submittedBytes).toEqual(await take?.arrayBuffer());
    expect(result.current.isActive).toBe(false);

    if (state === 'pending') {
      await act(async () => failDecode());
    }
    expect(result.current.previewPeaks).toBeUndefined();
    expect(result.current.error).toBe('');
  },
);

it('clears the old peaks when native capture stops on a paused take', async () => {
  vi.useFakeTimers();
  const { decode, recordSamples, stopCapture } = mockRecordedAudio();
  decode.mockImplementationOnce(async (bytes) => decodeFixtureSamples(bytes));
  decode.mockImplementationOnce(() => new Promise(() => {}));
  const { result } = renderHook(() => useVoiceRecorder(() => undefined));

  await act(() => result.current.start());
  // prettier-ignore
  recordSamples({
    durationMs: 100,
    pulseAtMs: 70,
    pulse: 192,
  });
  await act(async () => result.current.pause());
  const pausedBlob = result.current.preview;
  expect(result.current.previewPeaks).toContain(0.5);

  await act(async () => stopCapture());
  expect(result.current.isRecording).toBe(false);
  expect(result.current.preview).not.toBe(pausedBlob);
  expect(result.current.previewPeaks).toBeUndefined();
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
