import { Mic, Pause, Play, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton';
import { pauseOtherMedia } from '@/lib/mediaPlayback';
import type { useVoiceRecorder } from './useVoiceRecorder';
import styles from './VoiceRecordingBar.module.css';

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MAX_WAVEFORM_HEIGHT = 22;
const MIN_WAVEFORM_HEIGHT = 2;

interface VoiceRecordingBarProps {
  recorder: ReturnType<typeof useVoiceRecorder>;
}

function formatElapsedTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / MILLISECONDS_PER_SECOND);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const remainingSeconds = String(seconds % SECONDS_PER_MINUTE).padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

function RecordingWaveform({ levels }: { levels: number[] }) {
  return (
    <span className={styles.waveform} aria-hidden="true">
      {levels.length === 0 && <span className={styles.quietLine} />}
      {levels.map((level, index) => {
        const height = Math.max(MIN_WAVEFORM_HEIGHT, level * MAX_WAVEFORM_HEIGHT);
        return <span className={styles.sample} key={index} style={{ height }} />;
      })}
    </span>
  );
}

function RecordingPreview({ blob }: { blob: Blob }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [source, setSource] = useState<{ blob: Blob; url: string }>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const url = source?.blob === blob ? source.url : undefined;

  useEffect(() => {
    const player = audio.current;
    const previewUrl = URL.createObjectURL(blob);
    setSource({ blob, url: previewUrl });
    setIsPlaying(false);
    setPlaybackError(false);
    return () => {
      if (player && !player.paused) {
        player.pause();
      }
      URL.revokeObjectURL(previewUrl);
    };
  }, [blob]);

  async function togglePlayback() {
    const player = audio.current;
    if (!player) {
      return;
    }
    if (!player.paused) {
      player.pause();
      return;
    }

    pauseOtherMedia(player);
    try {
      await player.play();
    } catch {
      setPlaybackError(true);
    }
  }

  return (
    <>
      <audio
        ref={audio}
        src={url}
        preload="none"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={() => setPlaybackError(true)}
      />
      <IconButton
        label={isPlaying ? 'Pause recording preview' : 'Play recording preview'}
        className={styles.preview}
        disabled={!url}
        onClick={() => void togglePlayback()}
      >
        {isPlaying ? <Pause /> : <Play />}
      </IconButton>
      {playbackError && (
        <span className={styles.visuallyHidden} role="status">
          This recording preview could not be played.
        </span>
      )}
    </>
  );
}

function recordingStatus(recorder: VoiceRecordingBarProps['recorder']): string {
  if (recorder.isRequesting) {
    return 'Starting microphone…';
  }
  if (recorder.isFinalizing) {
    return 'Finishing recording…';
  }
  if (recorder.isSending) {
    return 'Queuing voice message…';
  }
  if (recorder.isPaused) {
    return 'Recording paused';
  }
  if (recorder.isRecording) {
    return 'Recording…';
  }

  return 'Voice recording ready';
}

/** Replace the editor controls during voice capture and keep recording actions in one row. */
export function VoiceRecordingBar({ recorder }: VoiceRecordingBarProps) {
  const isBusy = recorder.isFinalizing || recorder.isSending;
  const status = recordingStatus(recorder);
  const shouldShowStatus = recorder.isRequesting || isBusy;

  return (
    <div className={styles.bar} role="group" aria-label="Voice recording controls">
      <IconButton
        label="Cancel recording"
        className={styles.cancel}
        disabled={recorder.isSending}
        onClick={recorder.cancel}
      >
        <Trash2 />
      </IconButton>
      <div className={styles.track} dir="ltr">
        {shouldShowStatus ? (
          <span className={styles.pending} role="status">
            {status}
          </span>
        ) : (
          <>
            {recorder.preview ? (
              <RecordingPreview blob={recorder.preview} />
            ) : (
              <span className={styles.dot} data-paused={recorder.isPaused} aria-hidden="true" />
            )}
            <RecordingWaveform levels={recorder.waveform} />
            <span className={styles.timer} aria-label="Recording duration">
              {formatElapsedTime(recorder.elapsedMs)}
            </span>
            <span className={styles.visuallyHidden} role="status">
              {status}
            </span>
          </>
        )}
      </div>
      {recorder.isRecording && recorder.canPause && (
        <IconButton
          label={recorder.isPaused ? 'Resume recording' : 'Pause recording'}
          onClick={recorder.isPaused ? recorder.resume : recorder.pause}
        >
          {recorder.isPaused ? <Mic /> : <Pause />}
        </IconButton>
      )}
      <IconButton
        label="Send voice message"
        className={styles.send}
        disabled={!recorder.canSend}
        onClick={recorder.send}
      >
        <Send />
      </IconButton>
    </div>
  );
}
