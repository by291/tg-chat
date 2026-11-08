import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { MessageMedia } from '@/features/chat/messageMedia';
import { pauseOtherMedia } from '@/features/chat/messages/useVisiblePlayback';
import styles from './VideoPlayer.module.css';

const SECONDS_PER_MINUTE = 60;
const SEEK_STEP_SECONDS = 0.1;
const VOLUME_STEP = 0.05;
const CONTROLS_IDLE_MILLISECONDS = 3000;

interface VideoPlayerProps {
  media: Extract<MessageMedia, { kind: 'video' }>;
  isActive: boolean;
}

function formatPlaybackTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / SECONDS_PER_MINUTE);
  const remainder = Math.floor(safeSeconds % SECONDS_PER_MINUTE);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function keepControlKeys(event: KeyboardEvent) {
  // Escape must reach the dialog; slider arrows must never navigate the gallery.
  if (event.key !== 'Escape') {
    event.stopPropagation();
  }
}

function exitPlayerFullscreen(player: HTMLElement | null) {
  if (player && document.fullscreenElement === player) {
    // Closing the dialog must also release a fullscreen element retained for its exit animation.
    void document.exitFullscreen().catch(() => {});
  }
}

/** Play a viewer video with accessible custom controls. */
export function VideoPlayer({ media, isActive }: VideoPlayerProps) {
  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isActiveRef = useRef(isActive);
  const playbackAttempt = useRef(0);
  const controlsRef = useRef<HTMLDivElement>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isDraggingControl = useRef(false);
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(media.duration);
  const [error, setError] = useState('');

  function revealControls() {
    clearTimeout(hideControlsTimer.current);
    setAreControlsVisible(true);
    if (!isPlaying || !isActive) {
      return;
    }
    hideControlsTimer.current = setTimeout(() => {
      const hasControlFocus = controlsRef.current?.contains(document.activeElement);
      if (!isDraggingControl.current && !hasControlFocus) {
        setAreControlsVisible(false);
      }
    }, CONTROLS_IDLE_MILLISECONDS);
  }

  useEffect(() => {
    function finishControlInteraction() {
      if (!isDraggingControl.current) {
        return;
      }
      isDraggingControl.current = false;
      revealControls();
    }

    revealControls();
    // Releasing a drag outside the player must not leave its controls permanently pinned.
    document.addEventListener('pointerup', finishControlInteraction);
    document.addEventListener('pointercancel', finishControlInteraction);
    return () => {
      clearTimeout(hideControlsTimer.current);
      document.removeEventListener('pointerup', finishControlInteraction);
      document.removeEventListener('pointercancel', finishControlInteraction);
    };
  }, [isPlaying, isActive]);

  async function playVideo() {
    const video = videoRef.current;
    if (!video || !isActiveRef.current) {
      return;
    }
    setError('');
    playbackAttempt.current += 1;
    const attempt = playbackAttempt.current;
    try {
      pauseOtherMedia(video);
      await video.play();
      // A pending play promise can settle after the closing transition has started.
      if (!isActiveRef.current) {
        video.pause();
      }
    } catch (playbackError) {
      // Strict Mode and rapid navigation can reject an obsolete play request after a new one starts.
      const isCurrentAttempt = attempt === playbackAttempt.current;
      const isInterrupted =
        playbackError instanceof DOMException && playbackError.name === 'AbortError';
      if (isActiveRef.current && isCurrentAttempt && !isInterrupted) {
        setError('Video could not be played. Try playing it again.');
      }
    }
  }

  useLayoutEffect(() => {
    const video = videoRef.current;
    const player = playerRef.current;
    isActiveRef.current = isActive;
    if (isActive) {
      void playVideo();
    } else {
      video?.pause();
    }

    return () => {
      isActiveRef.current = false;
      playbackAttempt.current += 1;
      video?.pause();
      exitPlayerFullscreen(player);
    };
  }, [isActive, media.url]);

  useEffect(() => {
    function updateFullscreen() {
      setIsFullscreen(document.fullscreenElement === playerRef.current);
    }
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video || !isActive) {
      return;
    }
    if (video.paused) {
      void playVideo();
      return;
    }
    video.pause();
  }

  function seekVideo(seconds: number) {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const nextTime = Math.max(0, Math.min(seconds, duration));
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function changeVolume(nextVolume: number) {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.volume = nextVolume;
    video.muted = nextVolume === 0;
    setVolume(nextVolume);
    setIsMuted(video.muted);
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.volume === 0) {
      changeVolume(1);
      return;
    }
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === playerRef.current) {
        await document.exitFullscreen();
        return;
      }
      const player = playerRef.current;
      await player?.requestFullscreen();
      if (!isActiveRef.current) {
        exitPlayerFullscreen(player);
      }
    } catch {
      setError('Fullscreen is not available.');
    }
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const elapsedLabel = `${formatPlaybackTime(currentTime)} / ${formatPlaybackTime(duration)}`;

  return (
    <div
      ref={playerRef}
      className={styles.player}
      role="group"
      aria-label="Video player"
      tabIndex={0}
      data-controls-visible={areControlsVisible}
      onPointerMove={revealControls}
      onFocus={revealControls}
      onBlur={revealControls}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          togglePlayback();
        }
      }}
    >
      <video
        ref={videoRef}
        className={styles.video}
        src={media.url}
        poster={media.poster}
        playsInline
        preload="auto"
        onClick={togglePlayback}
        onDoubleClick={() => void toggleFullscreen()}
        onPlay={() => {
          setError('');
          setIsPlaying(true);
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const loadedDuration = event.currentTarget.duration;
          if (Number.isFinite(loadedDuration) && loadedDuration > 0) {
            setDuration(loadedDuration);
          }
        }}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setIsMuted(event.currentTarget.muted);
        }}
        onError={() => setError('Video could not be loaded.')}
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div
        ref={controlsRef}
        className={styles.controls}
        role="group"
        aria-label="Video controls"
        data-visible={areControlsVisible}
        onKeyDown={keepControlKeys}
        onPointerDown={() => {
          isDraggingControl.current = true;
          revealControls();
        }}
      >
        <input
          className={styles.seek}
          type="range"
          aria-label="Seek video"
          aria-valuetext={elapsedLabel}
          min={0}
          max={duration}
          step={SEEK_STEP_SECONDS}
          value={currentTime}
          style={{ '--progress': `${progress}%` } as CSSProperties}
          onChange={(event) => seekVideo(Number(event.currentTarget.value))}
        />
        <div className={styles.buttons}>
          <button
            type="button"
            aria-label={isPlaying ? 'Pause video' : 'Play video'}
            onClick={togglePlayback}
          >
            {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          </button>
          <span className={styles.time}>{elapsedLabel}</span>
          <div className={styles.volume}>
            <button
              type="button"
              aria-label={isMuted || volume === 0 ? 'Unmute video' : 'Mute video'}
              onClick={toggleMute}
            >
              {isMuted || volume === 0 ? <VolumeX /> : <Volume2 />}
            </button>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={VOLUME_STEP}
              value={isMuted ? 0 : volume}
              onChange={(event) => changeVolume(Number(event.currentTarget.value))}
            />
          </div>
          <button
            type="button"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={() => void toggleFullscreen()}
          >
            {isFullscreen ? <Minimize /> : <Maximize />}
          </button>
        </div>
      </div>
    </div>
  );
}
