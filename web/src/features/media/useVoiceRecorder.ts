import { useEffect, useRef, useState } from 'react';
import type { MediaSelection } from './uploadTransfer';

const MAX_RECORDING_MS = 10 * 60 * 1000;
const PREFERRED_FORMATS = ['audio/webm;codecs=opus', 'audio/mp4'];
const RECORDING_CHUNK_MS = 1000;

interface Recording {
  recorder: MediaRecorder;
  stream: MediaStream;
  timer: ReturnType<typeof setTimeout>;
  hasCancelled: boolean;
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/** Record a supported microphone format and release the stream on every exit path. */
export function useVoiceRecorder(onFinish: (selection: MediaSelection) => void) {
  const active = useRef<Recording>(undefined);
  const generation = useRef(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState('');
  const isSupported =
    typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    return () => {
      generation.current += 1;
      const recording = active.current;
      if (!recording) {
        return;
      }
      recording.hasCancelled = true;
      clearTimeout(recording.timer);
      if (recording.recorder.state !== 'inactive') {
        recording.recorder.stop();
      }
      stopTracks(recording.stream);
      active.current = undefined;
    };
  }, []);

  function stop(): void {
    const recording = active.current;
    if (recording?.recorder.state === 'recording') {
      recording.recorder.stop();
    }
  }

  function cancel(): void {
    generation.current += 1;
    setIsRequesting(false);
    const recording = active.current;
    if (!recording) {
      return;
    }
    recording.hasCancelled = true;
    stop();
    stopTracks(recording.stream);
  }

  async function start(): Promise<void> {
    if (!isSupported || isRequesting || active.current) {
      return;
    }
    const attempt = ++generation.current;
    setIsRequesting(true);
    setError('');
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (attempt !== generation.current) {
        stopTracks(stream);
        return;
      }
      const mimeType = PREFERRED_FORMATS.find((format) => MediaRecorder.isTypeSupported(format));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      const recording: Recording = {
        recorder,
        stream,
        hasCancelled: false,
        timer: setTimeout(stop, MAX_RECORDING_MS),
      };
      active.current = recording;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      });
      recorder.addEventListener('stop', () => {
        clearTimeout(recording.timer);
        stopTracks(recording.stream);
        if (active.current !== recording) {
          return;
        }
        active.current = undefined;
        setIsRecording(false);
        if (!recording.hasCancelled && chunks.length > 0) {
          const type = recorder.mimeType || chunks[0].type;
          const extension = type.includes('mp4') ? 'm4a' : 'webm';
          onFinish({
            blob: new Blob(chunks, { type }),
            kind: 'voice',
            filename: `Voice message.${extension}`,
          });
        }
      });
      recorder.addEventListener('error', () => {
        recording.hasCancelled = true;
        stopTracks(recording.stream);
        setError('Recording stopped unexpectedly.');
      });
      recorder.start(RECORDING_CHUNK_MS);
      setIsRecording(true);
    } catch {
      if (stream) {
        stopTracks(stream);
      }
      if (attempt === generation.current) {
        const recording = active.current;
        if (recording) {
          clearTimeout(recording.timer);
          active.current = undefined;
        }
        setError('Microphone recording is unavailable.');
      }
    } finally {
      if (attempt === generation.current) {
        setIsRequesting(false);
      }
    }
  }

  return { isSupported, isRecording, isRequesting, error, start, stop, cancel };
}
