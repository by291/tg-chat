import { useEffect, useRef, useState } from 'react';
import type { MediaSelection } from './uploadTransfer';
import { createVoiceRecordingMeter, type VoiceRecordingMeter } from './voiceRecordingMeter';

const MAX_RECORDING_MS = 10 * 60 * 1000;
const PREFERRED_FORMATS = ['audio/webm;codecs=opus', 'audio/mp4'];
const RECORDING_CHUNK_MS = 1000;
const METER_INTERVAL_MS = 80;

type RecordingPhase =
  'idle' | 'requesting' | 'recording' | 'paused' | 'finalizing' | 'ready' | 'sending';

interface Recording {
  recorder: MediaRecorder;
  stream: MediaStream;
  meter?: VoiceRecordingMeter;
  chunks: Blob[];
  elapsedMs: number;
  startedAt?: number;
  limitTimer?: ReturnType<typeof setTimeout>;
  meterTimer?: ReturnType<typeof setInterval>;
  shouldSend: boolean;
}

interface RecordingView {
  phase: RecordingPhase;
  elapsedMs: number;
  waveform: number[];
  preview?: Blob;
  error: string;
}

type RecordingSubmission = (selection: MediaSelection) => boolean | void | Promise<boolean | void>;

const EMPTY_VIEW: RecordingView = {
  phase: 'idle',
  elapsedMs: 0,
  waveform: [],
  error: '',
};

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function elapsedTime(recording: Recording): number {
  if (recording.startedAt === undefined) {
    return recording.elapsedMs;
  }

  return Math.min(MAX_RECORDING_MS, recording.elapsedMs + performance.now() - recording.startedAt);
}

function stopClock(recording: Recording): void {
  recording.elapsedMs = elapsedTime(recording);
  recording.startedAt = undefined;
  clearTimeout(recording.limitTimer);
  clearInterval(recording.meterTimer);
}

function releaseRecording(recording: Recording): void {
  stopClock(recording);
  try {
    if (recording.recorder.state !== 'inactive') {
      recording.recorder.stop();
    }
  } catch {
    // A disconnected capture device may already have stopped the recorder.
  } finally {
    stopTracks(recording.stream);
    recording.meter?.dispose();
  }
}

function recordingBlob(recording: Recording): Blob | undefined {
  if (recording.chunks.length === 0) {
    return;
  }

  const type = recording.recorder.mimeType || recording.chunks[0].type;
  return new Blob(recording.chunks, { type });
}

/** Record, preview, and submit voice while fencing microphone and admission lifetimes. */
export function useVoiceRecorder(onFinish: RecordingSubmission) {
  const [view, setView] = useState(EMPTY_VIEW);
  const currentView = useRef(EMPTY_VIEW);
  const active = useRef<Recording>(undefined);
  const readySelection = useRef<MediaSelection>(undefined);
  const generation = useRef(0);
  const submit = useRef(onFinish);
  const isSupported =
    typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    submit.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    return () => {
      generation.current += 1;
      const recording = active.current;
      active.current = undefined;
      readySelection.current = undefined;
      if (recording) {
        releaseRecording(recording);
      }
    };
  }, []);

  function publish(patch: Partial<RecordingView>) {
    const next = { ...currentView.current, ...patch };
    currentView.current = next;
    setView(next);
  }

  function cancel() {
    if (currentView.current.phase === 'sending') {
      return;
    }
    generation.current += 1;
    const recording = active.current;
    active.current = undefined;
    readySelection.current = undefined;
    if (recording) {
      releaseRecording(recording);
    }
    publish({ ...EMPTY_VIEW, preview: undefined });
  }

  function failRecording(recording: Recording) {
    if (active.current === recording) {
      cancel();
      publish({ error: 'Recording stopped unexpectedly.' });
    }
  }

  async function submitReady(selection: MediaSelection) {
    const attempt = generation.current;
    publish({ phase: 'sending', error: '' });
    let isAccepted = false;
    try {
      isAccepted = (await submit.current(selection)) !== false;
    } catch {
      // The recording stays available until the queue confirms admission.
    }
    if (attempt !== generation.current) {
      return;
    }
    if (isAccepted) {
      readySelection.current = undefined;
      publish({ ...EMPTY_VIEW, preview: undefined });
      return;
    }

    publish({ phase: 'ready', error: 'The voice message could not be queued. Try again.' });
  }

  function finalize(recording: Recording) {
    if (active.current !== recording || currentView.current.phase === 'finalizing') {
      return;
    }

    stopClock(recording);
    publish({ phase: 'finalizing', elapsedMs: recording.elapsedMs, preview: undefined });
    try {
      recording.recorder.stop();
    } catch {
      failRecording(recording);
    }
  }

  function send() {
    const phase = currentView.current.phase;
    const recording = active.current;
    if (recording && (phase === 'recording' || phase === 'paused')) {
      recording.shouldSend = true;
      finalize(recording);
      return;
    }

    if (phase === 'ready' && readySelection.current) {
      void submitReady(readySelection.current);
    }
  }

  function startClock(recording: Recording) {
    recording.startedAt = performance.now();
    recording.limitTimer = setTimeout(
      () => finalize(recording),
      MAX_RECORDING_MS - recording.elapsedMs,
    );
    recording.meterTimer = setInterval(() => {
      if (active.current !== recording || currentView.current.phase !== 'recording') {
        return;
      }
      publish({
        elapsedMs: elapsedTime(recording),
        waveform: recording.meter?.read() ?? currentView.current.waveform,
      });
    }, METER_INTERVAL_MS);
  }

  function pause() {
    const recording = active.current;
    if (
      !recording ||
      currentView.current.phase !== 'recording' ||
      typeof recording.recorder.pause !== 'function'
    ) {
      return;
    }

    stopClock(recording);
    publish({ phase: 'paused', elapsedMs: recording.elapsedMs });
    try {
      recording.recorder.pause();
    } catch {
      failRecording(recording);
    }
  }

  function resume() {
    const recording = active.current;
    if (
      !recording ||
      currentView.current.phase !== 'paused' ||
      typeof recording.recorder.resume !== 'function'
    ) {
      return;
    }

    publish({ phase: 'recording', preview: undefined, error: '' });
    try {
      recording.recorder.resume();
      startClock(recording);
    } catch {
      failRecording(recording);
    }
  }

  function finish(recording: Recording) {
    if (active.current !== recording) {
      return;
    }
    active.current = undefined;
    releaseRecording(recording);

    const blob = recordingBlob(recording);
    if (!blob) {
      publish({ ...EMPTY_VIEW, error: 'No audio was recorded. Try again.' });
      return;
    }

    const extension = blob.type.includes('mp4') ? 'm4a' : 'webm';
    const selection: MediaSelection = {
      blob,
      kind: 'voice',
      filename: `Voice message.${extension}`,
    };
    readySelection.current = selection;
    publish({ phase: 'ready', elapsedMs: recording.elapsedMs, preview: blob });
    if (recording.shouldSend) {
      void submitReady(selection);
    }
  }

  function watchRecording(recording: Recording) {
    const { recorder } = recording;
    recorder.addEventListener('dataavailable', (event) => {
      if (active.current !== recording) {
        return;
      }
      if (event.data.size > 0) {
        recording.chunks.push(event.data);
      }
      if (currentView.current.phase === 'paused') {
        publish({ preview: recordingBlob(recording) });
      }
    });
    recorder.addEventListener('pause', () => {
      if (active.current === recording && currentView.current.phase === 'paused') {
        // Flush the last slice so the preview includes audio recorded just before pausing.
        try {
          recorder.requestData();
        } catch {
          publish({ preview: recordingBlob(recording) });
        }
      }
    });
    recorder.addEventListener('stop', () => finish(recording));
    recorder.addEventListener('error', () => failRecording(recording));
  }

  async function start() {
    if (!isSupported || currentView.current.phase !== 'idle') {
      return;
    }
    const attempt = ++generation.current;
    publish({ ...EMPTY_VIEW, phase: 'requesting', preview: undefined });
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (attempt !== generation.current) {
        stopTracks(stream);
        return;
      }

      const mimeType = PREFERRED_FORMATS.find((format) => MediaRecorder.isTypeSupported(format));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const recording: Recording = {
        recorder,
        stream,
        chunks: [],
        meter: createVoiceRecordingMeter(stream),
        elapsedMs: 0,
        shouldSend: false,
      };
      active.current = recording;
      watchRecording(recording);
      recorder.start(RECORDING_CHUNK_MS);
      publish({ phase: 'recording' });
      startClock(recording);
    } catch {
      const recording = active.current;
      if (recording && recording.stream === stream) {
        active.current = undefined;
        releaseRecording(recording);
      } else if (stream) {
        stopTracks(stream);
      }
      if (attempt === generation.current) {
        publish({ ...EMPTY_VIEW, error: 'Microphone recording is unavailable.' });
      }
    }
  }

  const { phase, ...recordingView } = view;
  const isPaused = phase === 'paused';
  const isRecording = phase === 'recording' || isPaused;
  const nativeRecorder = active.current?.recorder;
  const canPause =
    typeof nativeRecorder?.pause === 'function' && typeof nativeRecorder?.resume === 'function';
  return {
    ...recordingView,
    isSupported,
    isActive: phase !== 'idle',
    isRequesting: phase === 'requesting',
    isFinalizing: phase === 'finalizing',
    isSending: phase === 'sending',
    isRecording,
    isPaused,
    canPause,
    canSend: isRecording || phase === 'ready',
    start,
    pause,
    resume,
    send,
    cancel,
  };
}
