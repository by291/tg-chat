import { animate } from 'motion';
import { useLayoutEffect } from 'react';

const STARTUP_FADE_SECONDS = 0.15;
const ROW_STAGGER_SECONDS = 0.015;

interface StartupTransitionOptions {
  isReady: boolean;
  shouldReduceMotion: boolean;
}

function getVisibleStartupRows() {
  const rows = document.querySelectorAll<HTMLElement>('[data-conversation-index]');
  return Array.from(rows).filter((row) => {
    if (row.closest('[inert]')) {
      return false;
    }

    const viewport = row.closest('nav');
    if (!viewport) {
      return false;
    }

    const bounds = row.getBoundingClientRect();
    const viewportBounds = viewport.getBoundingClientRect();
    const isVerticallyVisible =
      bounds.bottom > Math.max(0, viewportBounds.top) &&
      bounds.top < Math.min(window.innerHeight, viewportBounds.bottom);
    const isHorizontallyVisible = bounds.right > 0 && bounds.left < window.innerWidth;
    return bounds.height > 0 && isVerticallyVisible && isHorizontallyVisible;
  });
}

function startTransition(frame: HTMLElement) {
  const rows = getVisibleStartupRows();
  const originalOpacities = rows.map((row) => row.style.opacity);
  const rowAnimations = rows.map((row, index) =>
    animate(
      row,
      { opacity: [0, 1] },
      {
        duration: STARTUP_FADE_SECONDS,
        delay: index * ROW_STAGGER_SECONDS,
        ease: 'easeInOut',
        onComplete: () => {
          row.style.opacity = originalOpacities[index];
        },
      },
    ),
  );
  // The cover never takes focus or pointer input; ready controls work during its exit.
  const frameAnimation = animate(
    frame,
    { opacity: 0 },
    {
      duration: STARTUP_FADE_SECONDS,
      ease: 'easeInOut',
      onComplete: () => frame.remove(),
    },
  );

  return () => {
    frameAnimation.stop();
    rowAnimations.forEach((animation, index) => {
      animation.stop();
      rows[index].style.opacity = originalOpacities[index];
    });
  };
}

/** Reveal ready content with a frame crossfade and a one-time stagger of visible conversation rows. */
export function useStartupTransition({ isReady, shouldReduceMotion }: StartupTransitionOptions) {
  useLayoutEffect(() => {
    if (!isReady) {
      return;
    }

    const frame = document.getElementById('startup-frame');
    if (!frame) {
      return;
    }
    if (shouldReduceMotion) {
      frame.remove();
      return;
    }

    let stopTransition: (() => void) | undefined;
    // The virtualizer measures its viewport in layout effects; read rows after that render settles.
    const animationFrame = requestAnimationFrame(() => {
      stopTransition = startTransition(frame);
    });

    return () => {
      cancelAnimationFrame(animationFrame);
      stopTransition?.();
    };
  }, [isReady, shouldReduceMotion]);
}
