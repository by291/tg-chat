import { Mic, Pause, Play, Send, Trash2 } from 'lucide-react';
import { motion, useIsPresent, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton';
import { pauseOtherMedia } from '@/lib/mediaPlayback';
import { RecordingWaveform } from './RecordingWaveform';
import type { useVoiceRecorder } from './useVoiceRecorder';
import styles from './VoiceRecordingBar.module.css';

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const CENTISECONDS_PER_SECOND = 100;
const SEEK_STEP_SECONDS = 0.01;
const FADE_SECONDS = 0.15;
// prettier-ignore
const APPEARANCE_EASE: [number, number, number, number] = [
  0.25,
  0.1,
  0.25,
  1,
];
const EMPTY_PEAKS: readonly number[] = [];

interface VoiceRecordingBarProps {
  recorder: ReturnType<typeof useVoiceRecorder>;
}

interface RecordingPreviewProps {
  blob: Blob;
  elapsedMs: number;
  peaks: readonly number[];
  isPresent: boolean;
}

function formatRecordingTime(seconds: number): string {
  const totalCentiseconds = Math.floor(seconds * CENTISECONDS_PER_SECOND);
  const wholeSeconds = Math.floor(totalCentiseconds / CENTISECONDS_PER_SECOND);
  const minutes = Math.floor(wholeSeconds / SECONDS_PER_MINUTE);
  const remainingSeconds = String(wholeSeconds % SECONDS_PER_MINUTE).padStart(2, '0');
  const centiseconds = String(totalCentiseconds % CENTISECONDS_PER_SECOND).padStart(2, '0');
  return `${minutes}:${remainingSeconds},${centiseconds}`;
}

function RecordingPreview({ blob, elapsedMs, peaks, isPresent }: RecordingPreviewProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const source = useRef<string>(undefined);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasPlaybackError, setHasPlaybackError] = useState(false);
  const [position, setPosition] = useState<number>();
  const [mediaDuration, setMediaDuration] = useState<number>();
  const duration = mediaDuration ?? elapsedMs / MILLISECONDS_PER_SECOND;
  const currentTime = position ?? 0;
  const progress = position !== undefined && duration > 0 ? Math.min(1, currentTime / duration) : 1;
  const timer = formatRecordingTime(position ?? duration);
  const timerLabel = position === undefined ? 'Recording duration' : 'Playback time';

  useLayoutEffect(() => {
    const player = audio.current;
    if (!isPresent || !player) {
      return;
    }

    const previewUrl = URL.createObjectURL(blob);
    source.current = previewUrl;
    player.src = previewUrl;
    setIsReady(true);
    setIsPlaying(false);
    setHasPlaybackError(false);
    setPosition(undefined);
    setMediaDuration(undefined);

    return () => {
      // Exit motion can keep the controls mounted after their audio ownership has ended.
      source.current = undefined;
      if (!player.paused) {
        player.pause();
      }
      player.removeAttribute('src');
      player.load();
      URL.revokeObjectURL(previewUrl);
    };
  }, [blob, isPresent]);

  useEffect(() => {
    const player = audio.current;
    if (!isPresent || !isPlaying || !player) {
      return;
    }

    const updatePosition = () => {
      if (player.paused) {
        return;
      }
      setPosition(player.currentTime);
      frame = requestAnimationFrame(updatePosition);
    };

    let frame = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, isPresent]);

  async function togglePlayback() {
    const player = audio.current;
    const previewUrl = source.current;
    if (!player || !previewUrl) {
      return;
    }
    if (!player.paused) {
      player.pause();
      return;
    }

    pauseOtherMedia(player);
    try {
      await player.play();
      if (source.current === previewUrl) {
        setHasPlaybackError(false);
      }
    } catch {
      if (source.current === previewUrl) {
        setHasPlaybackError(true);
      }
    }
  }

  function updateDuration(player: HTMLAudioElement) {
    // MediaRecorder can omit duration metadata on a partial WebM. The capture clock is finite.
    const duration = player.duration;
    if (Number.isFinite(duration) && duration > 0) {
      setMediaDuration(duration);
      setPosition((previous) =>
        previous === undefined ? undefined : Math.min(previous, duration),
      );
    }
  }

  function seekTo(seconds: number) {
    const player = audio.current;
    if (!player || !source.current) {
      return;
    }
    player.currentTime = seconds;
    setPosition(seconds);
  }

  return (
    <>
      <audio
        ref={audio}
        preload="metadata"
        onDurationChange={(event) => updateDuration(event.currentTarget)}
        onPlay={(event) => {
          setIsPlaying(true);
          setPosition(event.currentTarget.currentTime);
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setPosition(undefined);
        }}
        onTimeUpdate={(event) => {
          const player = event.currentTarget;
          if (!player.ended) {
            const seconds = player.currentTime;
            setPosition((previous) => (previous === undefined ? undefined : seconds));
          }
        }}
        onError={() => setHasPlaybackError(Boolean(source.current))}
      />
      <IconButton
        label={isPlaying ? 'Pause recording preview' : 'Play recording preview'}
        className={styles.preview}
        disabled={!isReady}
        onClick={() => void togglePlayback()}
      >
        {isPlaying ? <Pause /> : <Play />}
      </IconButton>
      <RecordingWaveform levels={peaks} isPreview progress={progress}>
        <input
          className={styles.seek}
          type="range"
          min={0}
          max={duration}
          step={SEEK_STEP_SECONDS}
          value={currentTime}
          disabled={!isReady || duration <= 0}
          aria-label="Recording preview playback position"
          aria-valuetext={`${formatRecordingTime(currentTime)} of ${formatRecordingTime(duration)}`}
          onChange={(event) => seekTo(event.currentTarget.valueAsNumber)}
        />
      </RecordingWaveform>
      <span className={styles.timer} aria-label={timerLabel}>
        {timer}
      </span>
      {hasPlaybackError && (
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
  const isPresent = useIsPresent();
  const shouldReduceMotion = useReducedMotion();
  const isBusy = recorder.isFinalizing || recorder.isSending;
  const status = recordingStatus(recorder);
  const shouldShowStatus = recorder.isRequesting || isBusy;

  return (
    <motion.div
      className={styles.bar}
      role="group"
      aria-label="Voice recording controls"
      aria-hidden={!isPresent}
      inert={!isPresent}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: shouldReduceMotion ? 0 : FADE_SECONDS, ease: APPEARANCE_EASE }}
    >
      <IconButton
        label="Cancel recording"
        className={styles.cancel}
        disabled={recorder.isSending}
        onClick={recorder.cancel}
      >
        <Trash2 />
      </IconButton>
      <div className={styles.track} dir="ltr">
        {shouldShowStatus && (
          <span className={styles.pending} role="status">
            {status}
          </span>
        )}
        {!shouldShowStatus && recorder.preview && (
          <RecordingPreview
            blob={recorder.preview}
            elapsedMs={recorder.elapsedMs}
            peaks={recorder.previewPeaks ?? EMPTY_PEAKS}
            isPresent={isPresent}
          />
        )}
        {!shouldShowStatus && !recorder.preview && (
          <>
            <span className={styles.dot} data-paused={recorder.isPaused} aria-hidden="true" />
            <RecordingWaveform levels={recorder.waveform} />
            <span className={styles.timer} aria-label="Recording duration">
              {formatRecordingTime(recorder.elapsedMs / MILLISECONDS_PER_SECOND)}
            </span>
          </>
        )}
        {!shouldShowStatus && (
          <span className={styles.visuallyHidden} role="status">
            {status}
          </span>
        )}
      </div>
      {recorder.isRecording && recorder.canPause && (
        <IconButton
          className={styles.pause}
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
    </motion.div>
  );
}
