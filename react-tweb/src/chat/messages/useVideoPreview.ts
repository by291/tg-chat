import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useAppPreferences } from '../../app/settings/appPreferences';
import { getStickerPlaybackState, subscribeStickerPlayback } from '../stickers/stickerPlayback';

interface VideoPreviewOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  source?: string;
  isPreview: boolean;
}

function hasAudibleRoundVideo() {
  const videos = document.querySelectorAll<HTMLVideoElement>('video[data-round-video]');
  for (const video of videos) {
    if (!video.muted && !video.paused && !video.ended) {
      return true;
    }
  }
  return false;
}

/** Load visible clips lazily and keep only muted previews eligible for automatic playback. */
export function useVideoPreview({ videoRef, source, isPreview }: VideoPreviewOptions) {
  const { shouldAutoplayVideos } = useAppPreferences();
  const [isVisible, setIsVisible] = useState(false);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [isRoundPlaying, setIsRoundPlaying] = useState(hasAudibleRoundVideo);
  const canPlayRef = useRef(false);
  const canPlayAudiblyRef = useRef(false);
  const policy = useSyncExternalStore(subscribeStickerPlayback, getStickerPlaybackState);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    function enforcePlaybackVisibility() {
      // A pending load or external play action must not restart media after it becomes hidden.
      if (!video || video.paused) {
        return;
      }
      // Explicit round playback can start before React commits the switch out of preview mode.
      const canStartPlayback = video.muted ? canPlayRef.current : canPlayAudiblyRef.current;
      if (!canStartPlayback) {
        video.pause();
      }
    }

    const observer = new IntersectionObserver((entries) => {
      // Fast scrolling can enqueue several transitions for this video in one delivery.
      const entry = entries.at(-1);
      if (!entry) {
        return;
      }
      setIsVisible(entry.isIntersecting);
      if (entry.isIntersecting) {
        setHasBeenVisible(true);
        return;
      }
      canPlayRef.current = false;
      canPlayAudiblyRef.current = false;
      enforcePlaybackVisibility();
    });
    observer.observe(video);
    video.addEventListener('play', enforcePlaybackVisibility);

    const frame = video.closest('[data-photo-id]');
    function synchronizeViewer() {
      setIsViewerOpen(frame?.getAttribute('data-viewer-source') === 'true');
    }
    const viewerObserver = new MutationObserver(synchronizeViewer);
    if (frame) {
      viewerObserver.observe(frame, { attributes: true, attributeFilter: ['data-viewer-source'] });
      synchronizeViewer();
    }

    function synchronizeRoundPlayback(event: Event) {
      const target = event.target;
      if (target instanceof HTMLVideoElement && target.hasAttribute('data-round-video')) {
        setIsRoundPlaying(hasAudibleRoundVideo());
      }
    }
    const captureOptions = { capture: true };
    document.addEventListener('play', synchronizeRoundPlayback, captureOptions);
    document.addEventListener('pause', synchronizeRoundPlayback, captureOptions);
    document.addEventListener('ended', synchronizeRoundPlayback, captureOptions);
    document.addEventListener('volumechange', synchronizeRoundPlayback, captureOptions);

    return () => {
      canPlayRef.current = false;
      canPlayAudiblyRef.current = false;
      observer.disconnect();
      viewerObserver.disconnect();
      video.removeEventListener('play', enforcePlaybackVisibility);
      document.removeEventListener('play', synchronizeRoundPlayback, captureOptions);
      document.removeEventListener('pause', synchronizeRoundPlayback, captureOptions);
      document.removeEventListener('ended', synchronizeRoundPlayback, captureOptions);
      document.removeEventListener('volumechange', synchronizeRoundPlayback, captureOptions);
      if (!video.paused) {
        video.pause();
      }
    };
  }, [videoRef]);

  const isPreviewBlocked =
    isPreview &&
    (!shouldAutoplayVideos ||
      policy.isReducedMotion ||
      Boolean(policy.exclusiveGroup) ||
      isRoundPlaying);
  const isOverlayBlockingPlayback =
    policy.exclusiveGroup === 'viewer' || policy.exclusiveGroup === 'theme';
  const canPlayAudibly =
    isVisible &&
    policy.isWindowActive &&
    !isViewerOpen &&
    !isOverlayBlockingPlayback &&
    Boolean(source);
  const canPlay = canPlayAudibly && !isPreviewBlocked;

  // prettier-ignore
  useEffect(() => {
    const video = videoRef.current;
    canPlayRef.current = canPlay;
    canPlayAudiblyRef.current = canPlayAudibly;
    if (!video) {
      return;
    }
    if (!canPlayRef.current) {
      if (!video.paused) {
        video.pause();
      }
      return;
    }
    if (isPreview && video.paused) {
      video.muted = true;
      video.loop = true;
      // Autoplay rejection is expected on restricted browsers; the explicit play action remains.
      void video.play().catch(() => {});
    }
  }, [
    canPlay,
    canPlayAudibly,
    isPreview,
    source,
    videoRef,
  ]);

  return hasBeenVisible ? source : undefined;
}
