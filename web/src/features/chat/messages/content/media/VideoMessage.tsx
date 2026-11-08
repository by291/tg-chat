import { Play, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getPhotoGeometry } from '@/features/media/mediaGeometry';
import { rememberPhotoSource } from '@/features/media/mediaViewerTransition';
import type { MessageMedia } from '@/domain/messages/media';
import { formatMediaDuration } from './VoiceMessage';
import { useDeferredMediaSource } from './deferredMedia';
import { useVideoPreview } from './useVideoPreview';
import { pauseOtherMedia } from '@/lib/mediaPlayback';
import styles from './VideoMessage.module.css';

const ROUND_DESKTOP_SIZE = 280;
const ROUND_MOBILE_SIZE = 240;
const RING_STROKE_WIDTH = 3.5;
const RING_INSET = RING_STROKE_WIDTH * 2;
const MUTED_ICON_SIZE = 18;
const PLAY_ICON_SIZE = 34;

interface VideoFrameProps {
  media: Extract<MessageMedia, { kind: 'video' }>;
  hasCaption: boolean;
  messageId?: string;
  onOpen?: () => void;
}

interface ProgressRingProps {
  diameter: number;
  progress: number;
  isMobile: boolean;
}

function ProgressRing({ diameter, progress, isMobile }: ProgressRingProps) {
  const radius = diameter / 2 - RING_INSET;
  const circumference = Math.PI * 2 * radius;

  return (
    <svg
      className={styles.progress}
      data-mobile={isMobile}
      viewBox={`0 0 ${diameter} ${diameter}`}
      aria-hidden="true"
    >
      <circle
        cx={diameter / 2}
        cy={diameter / 2}
        r={radius}
        fill="none"
        stroke="white"
        strokeWidth={RING_STROKE_WIDTH}
        strokeOpacity="0.3"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
      />
    </svg>
  );
}

function RoundVideo({ media }: Pick<VideoFrameProps, 'media'>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const source = useDeferredMediaSource(media.url);
  const poster = useDeferredMediaSource(media.poster);
  const [hasStarted, setHasStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState('');
  const displayedSource = useVideoPreview({
    videoRef,
    source,
    isPreview: !hasStarted,
  });
  const desktopSize = Math.min(media.width, ROUND_DESKTOP_SIZE);
  const mobileSize = Math.min(media.width, ROUND_MOBILE_SIZE);
  const progress = hasStarted ? Math.min(1, position / media.duration) : 0;
  const remaining = hasStarted ? Math.max(0, media.duration - position) : media.duration;
  const isAudiblePlayback = hasStarted && isPlaying;

  // Read the media element each frame; React's coarse timeupdate event would make the ring jump.
  useEffect(() => {
    if (!isAudiblePlayback) {
      return;
    }

    let animationFrame: number;
    function updateProgress() {
      setPosition(videoRef.current?.currentTime ?? 0);
      animationFrame = requestAnimationFrame(updateProgress);
    }
    animationFrame = requestAnimationFrame(updateProgress);

    return () => cancelAnimationFrame(animationFrame);
  }, [isAudiblePlayback]);

  useEffect(() => {
    function pauseForOtherMedia(event: Event) {
      const playingMedia = event.target;
      const video = videoRef.current;
      const isOtherPlayback = playingMedia instanceof HTMLMediaElement && playingMedia !== video;
      const isAudibleVideo = video && !video.muted && !video.paused;
      if (isOtherPlayback && !playingMedia.muted && isAudibleVideo) {
        video.pause();
      }
    }
    document.addEventListener('play', pauseForOtherMedia, true);

    return () => document.removeEventListener('play', pauseForOtherMedia, true);
  }, []);

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (hasStarted && !video.paused) {
      video.pause();
      return;
    }
    if (!hasStarted) {
      video.currentTime = 0;
      setPosition(0);
      setHasStarted(true);
    }
    pauseOtherMedia(video);
    video.muted = false;
    video.loop = false;
    try {
      await video.play();
      setError('');
    } catch {
      setError('Video could not be played. Tap to retry.');
    }
  }

  function restartPreview() {
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      video.muted = true;
      video.loop = true;
    }
    setHasStarted(false);
    setPosition(0);
  }

  return (
    <div
      className={styles.roundFrame}
      style={
        {
          '--round-desktop-size': `${desktopSize}px`,
          '--round-mobile-size': `${mobileSize}px`,
        } as CSSProperties
      }
    >
      <button
        className={styles.roundButton}
        type="button"
        aria-label={isAudiblePlayback ? 'Pause video message' : 'Play video message'}
        onClick={() => void togglePlayback()}
      >
        <video
          ref={videoRef}
          data-round-video
          src={displayedSource}
          poster={poster}
          width={media.width}
          height={media.height}
          muted={!hasStarted}
          loop={!hasStarted}
          playsInline
          preload="none"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
          onEnded={restartPreview}
          onError={() => setError('Video could not be loaded. Tap to retry.')}
        />
        <ProgressRing diameter={desktopSize} progress={progress} isMobile={false} />
        <ProgressRing diameter={mobileSize} progress={progress} isMobile />
      </button>
      <span className={styles.roundDuration} aria-label="Video message remaining time">
        {formatMediaDuration(remaining)}
        {!isAudiblePlayback && <VolumeX size={MUTED_ICON_SIZE} aria-hidden="true" />}
      </span>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function VideoPreview({ media, hasCaption, messageId, onOpen }: VideoFrameProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const source = useDeferredMediaSource(media.url);
  const poster = useDeferredMediaSource(media.poster);
  const displayedSource = useVideoPreview({
    videoRef,
    source,
    isPreview: true,
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  // The reference's inline mini-player is disabled, so videos use the same fitted box as photos.
  const frame = getPhotoGeometry({
    width: media.width,
    height: media.height,
    hasCaption,
  });

  return (
    <button
      className={styles.videoFrame}
      type="button"
      data-photo-id={messageId}
      style={{ width: frame.width, aspectRatio: `${frame.width} / ${frame.height}` }}
      aria-label="Open video"
      onClick={(event) => {
        videoRef.current?.pause();
        if (messageId) {
          rememberPhotoSource(messageId, event.currentTarget);
        }
        onOpen?.();
      }}
    >
      {frame.isFitted && <img className={styles.backdrop} src={poster} alt="" aria-hidden="true" />}
      <video
        ref={videoRef}
        src={displayedSource}
        poster={poster}
        width={media.width}
        height={media.height}
        muted
        loop
        playsInline
        preload="none"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
      />
      <span className={styles.duration}>
        {formatMediaDuration(Math.max(0, media.duration - position))}
        {isPlaying && <VolumeX size={MUTED_ICON_SIZE} aria-hidden="true" />}
      </span>
      {!isPlaying && (
        <span className={styles.play}>
          <Play size={PLAY_ICON_SIZE} />
        </span>
      )}
    </button>
  );
}

/** Keep video notes inline and open ordinary clips in the full media viewer. */
export function VideoFrame(props: VideoFrameProps) {
  if (props.media.isRound) {
    return <RoundVideo media={props.media} />;
  }
  return <VideoPreview {...props} />;
}
