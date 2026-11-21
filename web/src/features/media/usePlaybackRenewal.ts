import { useEffect, useRef, useState } from 'react';

interface ResumePoint {
  position: number;
  shouldPlay: boolean;
}

interface RenewalOptions {
  url: string;
  renew?: (signal: AbortSignal) => Promise<string>;
  onFailure: () => void;
  onResumeFailure?: () => void;
}

/** Recover a playback source at its prior position when a signed URL expires mid-stream. */
export function usePlaybackRenewal(options: RenewalOptions) {
  const { url, renew, onFailure, onResumeFailure = onFailure } = options;
  const [replacement, setReplacement] = useState<{ original: string; url: string }>();
  const displayedUrl = replacement?.original === url ? replacement.url : url;
  const pending = useRef<AbortController>(undefined);
  const point = useRef<ResumePoint>(undefined);
  const hasRetried = useRef(false);

  useEffect(() => {
    hasRetried.current = false;
    return () => {
      pending.current?.abort();
      pending.current = undefined;
      point.current = undefined;
    };
  }, [url, renew]);

  function onError(next: ResumePoint): void {
    if (!renew || hasRetried.current) {
      onFailure();
      return;
    }
    hasRetried.current = true;
    const controller = new AbortController();
    pending.current = controller;
    point.current = next;
    void renew(controller.signal).then(
      (updated) => {
        if (!controller.signal.aborted && updated !== displayedUrl) {
          setReplacement({ original: url, url: updated });
        } else if (!controller.signal.aborted) {
          onFailure();
        }
      },
      () => {
        if (!controller.signal.aborted) {
          onFailure();
        }
      },
    );
  }

  function restore(element: HTMLMediaElement): void {
    const saved = point.current;
    if (!saved) {
      return;
    }
    point.current = undefined;
    hasRetried.current = false;
    element.currentTime = Math.min(saved.position, element.duration || saved.position);
    if (saved.shouldPlay) {
      // Autoplay denial after recovery leaves a valid source for an explicit play gesture.
      void element.play().catch(onResumeFailure);
    }
  }

  return {
    src: displayedUrl,
    onError,
    restore,
  };
}
