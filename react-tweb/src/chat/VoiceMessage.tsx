import { useVisiblePlayback } from './useVisiblePlayback';
import { Pause, Play } from 'lucide-react';
import { useRef, useState } from 'react';
import type { MessageMedia } from './messageMedia';
import styles from './MessageBody.module.css';

const SECONDS_PER_MINUTE = 60;
const MIN_WAVEFORM_PERCENTAGE = 8;
const PERCENTAGE_SCALE = 100;
const SEEK_STEP_SECONDS = 0.1;

/** Format the duration shown beside the waveform. */
export function formatMediaDuration(seconds: number) {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const remainingSeconds = Math.floor(seconds % SECONDS_PER_MINUTE);
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

/** Connect the waveform and transport controls to an actual local audio element. */
export function VoiceMessage({ media }: { media: Extract<MessageMedia, { kind: 'voice' }> }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  useVisiblePlayback(audioRef);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState('');

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (!audio.paused) {
      audio.pause();
      return;
    }

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
        onTimeUpdate={() => setPosition(audioRef.current?.currentTime || 0)}
      />
      <button
        className={styles.playButton}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
        onClick={() => void togglePlayback()}
      >
        {isPlaying ? <Pause size={21} /> : <Play size={21} />}
      </button>
      <div className={styles.voiceTrack}>
        <div className={styles.waveform} aria-hidden="true">
          {media.waveform.map((amplitude, index) => (
            <span
              key={index}
              style={{
                height: `${Math.max(MIN_WAVEFORM_PERCENTAGE, amplitude * PERCENTAGE_SCALE)}%`,
              }}
              data-played={index / media.waveform.length <= position / media.duration}
            />
          ))}
        </div>
        <input
          className={styles.seekControl}
          type="range"
          min={0}
          max={media.duration}
          step={SEEK_STEP_SECONDS}
          value={position}
          aria-label="Voice message playback position"
          onChange={(event) => seekTo(Number(event.target.value))}
        />
        <span className={styles.duration}>{formatMediaDuration(position || media.duration)}</span>
        {error && <span role="alert">{error}</span>}
      </div>
    </div>
  );
}
