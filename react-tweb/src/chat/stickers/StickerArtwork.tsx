import { useEffect, useRef, useState } from 'react';
import type { AnimationItem } from 'lottie-web';
import type { Sticker } from './stickerCatalog';
import { loadStickerAnimation } from './loadStickerAnimation';
import { getStickerPlaybackState, subscribeStickerPlayback } from './stickerPlayback';
import { useStickerPlaybackGroup } from './StickerPlaybackScope';
import styles from './StickerArtwork.module.css';

/** Decode visible stickers and apply the shared window, overlay, and looping policy. */
export function StickerArtwork({
  sticker,
}: {
  sticker: Pick<Sticker, 'name' | 'source' | 'preview' | 'renderer'>;
}) {
  const playbackGroup = useStickerPlaybackGroup();
  const containerRef = useRef<HTMLSpanElement>(null);
  const [hasFailed, setHasFailed] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    setHasFailed(false);
    setIsReady(false);

    let animation: AnimationItem | undefined;
    let isVisible = false;
    let isDisposed = false;
    let hasStartedLoading = false;
    let hasCompleted = false;
    let playbackFrame: number | undefined;

    function pausePlayback() {
      if (playbackFrame !== undefined) {
        cancelAnimationFrame(playbackFrame);
        playbackFrame = undefined;
      }
      animation?.pause();
    }

    function synchronizePlayback() {
      if (!animation) {
        return;
      }
      const policy = getStickerPlaybackState();
      const isGroupAllowed = !policy.exclusiveGroup || policy.exclusiveGroup === playbackGroup;
      const shouldPlay =
        isVisible && policy.isWindowActive && !policy.isReducedMotion && isGroupAllowed;

      // Disabling looping finishes the current lap; re-enabling it releases a completed player.
      animation.loop = policy.shouldLoop;
      if (hasCompleted && policy.shouldLoop) {
        hasCompleted = false;
        animation.goToAndStop(0, true);
      }
      if (!shouldPlay || hasCompleted) {
        pausePlayback();
        return;
      }
      if (!animation.isPaused || playbackFrame !== undefined) {
        return;
      }

      // A hidden tab may retain Lottie's pending tick. Let it run while paused so its shared
      // clock settles before playing; otherwise the hidden time can jump or wrap the frame.
      playbackFrame = requestAnimationFrame(() => {
        playbackFrame = undefined;
        animation?.play();
      });
    }

    async function initializeAnimation() {
      if (hasStartedLoading) {
        return;
      }
      hasStartedLoading = true;
      try {
        const [playerModule, animationData] = await Promise.all([
          sticker.renderer === 'svg'
            ? import('lottie-web/build/player/lottie_light')
            : import('lottie-web/build/player/lottie_light_canvas'),
          loadStickerAnimation(sticker.source),
        ]);
        if (isDisposed || !container) {
          return;
        }
        // Lottie completes and mutates animation data; each player needs its own copy.
        animation = playerModule.default.loadAnimation({
          container,
          renderer: sticker.renderer,
          loop: getStickerPlaybackState().shouldLoop,
          autoplay: false,
          animationData: structuredClone(animationData),
          rendererSettings: { progressiveLoad: true },
        });
        animation.addEventListener('DOMLoaded', () => {
          setIsReady(true);
          synchronizePlayback();
        });
        animation.addEventListener('data_failed', () => setHasFailed(true));
        animation.addEventListener('error', () => setHasFailed(true));
        animation.addEventListener('complete', () => {
          // Focus and overlay changes must not replay a sticker that already finished once.
          hasCompleted = true;
        });
        synchronizePlayback();
      } catch {
        if (!isDisposed) {
          setHasFailed(true);
        }
      }
    }

    const observer = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
      if (isVisible) {
        void initializeAnimation();
      }
      synchronizePlayback();
    });
    const unsubscribePlayback = subscribeStickerPlayback(synchronizePlayback);
    observer.observe(container);
    return () => {
      isDisposed = true;
      observer.disconnect();
      unsubscribePlayback();
      pausePlayback();
      animation?.destroy();
    };
  }, [sticker.source, sticker.renderer, playbackGroup]);

  return (
    <span className={styles.artwork} role="img" aria-label={sticker.name}>
      <span ref={containerRef} className={styles.canvas} />
      {(!isReady || hasFailed) && (
        <img className={styles.preview} src={sticker.preview} alt="" draggable={false} />
      )}
    </span>
  );
}
