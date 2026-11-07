import { useEffect, useState, type RefObject } from 'react';

interface VideoPreviewOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  source?: string;
  isPreview: boolean;
}

/** Load visible clips lazily and keep only muted previews eligible for automatic playback. */
export function useVideoPreview({ videoRef, source, isPreview }: VideoPreviewOptions) {
  const [isVisible, setIsVisible] = useState(false);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(!document.hidden);
  const [shouldReduceMotion, setShouldReduceMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setIsVisible(entry.isIntersecting);
      if (entry.isIntersecting) {
        setHasBeenVisible(true);
      }
    });
    observer.observe(video);

    const frame = video.closest('[data-photo-id]');
    const viewerObserver = new MutationObserver(() => {
      setIsViewerOpen(frame?.getAttribute('data-viewer-source') === 'true');
    });
    if (frame) {
      viewerObserver.observe(frame, { attributes: true, attributeFilter: ['data-viewer-source'] });
    }

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    function updateMotionPreference() {
      setShouldReduceMotion(motionQuery.matches);
    }
    function updatePageVisibility() {
      setIsPageVisible(!document.hidden);
    }
    motionQuery.addEventListener('change', updateMotionPreference);
    document.addEventListener('visibilitychange', updatePageVisibility);

    return () => {
      observer.disconnect();
      viewerObserver.disconnect();
      motionQuery.removeEventListener('change', updateMotionPreference);
      document.removeEventListener('visibilitychange', updatePageVisibility);
      if (!video.paused) {
        video.pause();
      }
    };
  }, [videoRef]);

  useEffect(
    () => {
      const video = videoRef.current;
      if (!video || !source) {
        return;
      }
      const canPlay = isVisible && isPageVisible && !isViewerOpen;
      if (!canPlay || (isPreview && shouldReduceMotion)) {
        if (!video.paused) {
          video.pause();
        }
        return;
      }
      if (isPreview) {
        video.muted = true;
        video.loop = true;
        // Autoplay rejection is expected on restricted browsers; the explicit play action remains.
        void video.play().catch(() => {});
      }
    },
    // prettier-ignore
    [
    isPageVisible,
    isPreview,
    isViewerOpen,
    isVisible,
    shouldReduceMotion,
    source,
    videoRef,
  ],
  );

  return hasBeenVisible ? source : undefined;
}
