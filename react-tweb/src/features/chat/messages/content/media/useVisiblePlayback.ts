import { useEffect, type RefObject } from 'react';

/** Stop playback when a virtualized media row leaves the visible history viewport. */
export function useVisiblePlayback(mediaRef: RefObject<HTMLMediaElement | null>) {
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry.isIntersecting && !media.paused) {
        media.pause();
      }
    });
    // Audio without native controls has no box; observe its visible message shell.
    observer.observe(media.closest('article') || media);
    return () => {
      observer.disconnect();
      if (!media.paused) {
        media.pause();
      }
    };
  }, [mediaRef]);
}

/** Give one audible message playback ownership while leaving muted previews running. */
export function pauseOtherMedia(activeMedia: HTMLMediaElement) {
  const mediaElements = document.querySelectorAll<HTMLMediaElement>('audio, video');
  for (const media of mediaElements) {
    if (media !== activeMedia && !media.muted && !media.paused) {
      media.pause();
    }
  }
}
