import { pauseOtherMedia } from '@/lib/media/playback';
import { useVisiblePlayback } from './useVisiblePlayback';
import { Pause, Play } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import type { MessageMedia } from '@/domain/messages/media';
import { createVoiceWaveform } from './voiceWaveform';
import styles from './VoiceMessage.module.css';

const SECONDS_PER_MINUTE = 60;
const PERCENTAGE_SCALE = 100;
const SEEK_STEP_SECONDS = 0.1;
const FALLBACK_LINE_HEIGHT = 2;
const PLAYBACK_ICON_SIZE = 24;
const INACTIVE_WAVEFORM_OPACITY = 0.3;

interface VoiceWaveformProps {
  media: Extract<MessageMedia, { kind: 'voice' }>;
  progress: number;
  isMobile: boolean;
}

function VoiceWaveform({ media, progress, isMobile }: VoiceWaveformProps) {
  const gradientId = useId();
  const geometry = createVoiceWaveform({
    waveform: media.waveform,
    duration: media.duration,
    isMobile,
  });
  const progressOffset = `${progress * PERCENTAGE_SCALE}%`;

  return (
    <svg
      className={styles.waveform}
      data-mobile={isMobile}
      width={geometry.width}
      height={geometry.height}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          x2={geometry.width}
          y1="0"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset={progressOffset} stopColor="currentColor" />
          <stop
            offset={progressOffset}
            stopColor="currentColor"
            stopOpacity={INACTIVE_WAVEFORM_OPACITY}
          />
        </linearGradient>
      </defs>
      <g fill={`url(#${gradientId})`}>
        {geometry.bars.map((bar) => (
          <rect
            key={bar.left}
            x={bar.left}
            y={geometry.height - bar.height}
            width={bar.width}
            height={bar.height}
            rx="1"
          />
        ))}
        {geometry.bars.length === 0 && (
          <rect
            x="0"
            y={geometry.height - FALLBACK_LINE_HEIGHT}
            width={geometry.width}
            height={FALLBACK_LINE_HEIGHT}
            rx="1"
          />
        )}
      </g>
    </svg>
  );
}

/** Format the duration shown beside the waveform. */
export function formatMediaDuration(seconds: number) {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const remainingSeconds = Math.floor(seconds % SECONDS_PER_MINUTE);
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

/** Connect the waveform and transport controls to an actual local audio element. */
export function VoiceMessage({
  media,
  metadata,
}: {
  media: Extract<MessageMedia, { kind: 'voice' }>;
  metadata?: ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  useVisiblePlayback(audioRef);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState('');
  const shouldShowElapsedTime = isPlaying || position > 0;
  const displayedDuration = shouldShowElapsedTime ? position : media.duration;
  const progress = Math.min(1, Math.max(0, position / media.duration));

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (!audio.paused) {
      audio.pause();
      return;
    }

    pauseOtherMedia(audio);
    try {
      await audio.play();
      setError('');
    } catch {
      setError('Audio could not be played.');
    }
  }

  function seekTo(seconds: number) {
    if (audioRef.current) {
      audioRef.current.currentTime = seconds;
      setPosition(seconds);
    }
  }

  return (
    <div className={styles.voice}>
      <audio
        ref={audioRef}
        src={media.url}
        preload="none"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={() => setPosition(audioRef.current?.currentTime ?? 0)}
      />
      <button
        className={styles.playButton}
        type="button"
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
        onClick={() => void togglePlayback()}
      >
        {isPlaying ? <Pause size={PLAYBACK_ICON_SIZE} /> : <Play size={PLAYBACK_ICON_SIZE} />}
      </button>
      <div className={styles.voiceTrack}>
        <div className={styles.waveformContainer} dir="ltr">
          <VoiceWaveform media={media} progress={progress} isMobile={false} />
          <VoiceWaveform media={media} progress={progress} isMobile={true} />
          <input
            className={styles.seekControl}
            type="range"
            min={0}
            max={media.duration}
            step={SEEK_STEP_SECONDS}
            value={position}
            aria-label="Voice message playback position"
            aria-valuetext={`${formatMediaDuration(position)} of ${formatMediaDuration(media.duration)}`}
            onChange={(event) => seekTo(Number(event.target.value))}
          />
        </div>
        <div className={styles.durationRow}>
          <span className={styles.duration}>{formatMediaDuration(displayedDuration)}</span>
          {metadata}
        </div>
        {error && (
          <span className={styles.error} role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
