import { flushSync } from 'react-dom';

const REVEAL_DURATION = 600;
const CONCEAL_DURATION = 500;
const TRANSITION_TIMEOUT = 2000;
const TRANSITION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const PERCENT = 100;

export interface ThemeOrigin {
  left: number;
  top: number;
}

interface ThemeTransitionOptions {
  isDark: boolean;
  apply: () => void;
  origin?: ThemeOrigin;
}

function getRevealFrames(origin: ThemeOrigin): Keyframe[] {
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  const radius = Math.hypot(
    Math.max(origin.left, width - origin.left),
    Math.max(origin.top, height - origin.top),
  );
  // Percentages keep the reveal centered in CSS coordinates on high-DPI browser snapshots.
  const radiusPercent = (radius / Math.hypot(width, height)) * Math.SQRT2 * PERCENT;
  const center = `${(origin.left / width) * PERCENT}% ${(origin.top / height) * PERCENT}%`;
  return [
    { clipPath: `circle(0% at ${center})` },
    { clipPath: `circle(${radiusPercent}% at ${center})` },
  ];
}

let activeTransition: ViewTransition | undefined;

/** Reveal a new dark palette or shrink the old one while applying the requested theme once. */
export async function runThemeTransition({ isDark, apply, origin }: ThemeTransitionOptions) {
  if (activeTransition) {
    activeTransition.skipTransition();
  }
  const shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || shouldReduceMotion) {
    apply();
    return;
  }

  const root = document.documentElement;
  const revealOrigin = origin ?? { left: window.innerWidth / 2, top: window.innerHeight / 2 };
  root.dataset.themeTransition = isDark ? 'conceal' : 'reveal';
  // React must commit the new document palette before the second browser snapshot.
  const transition = document.startViewTransition(() => flushSync(apply));
  activeTransition = transition;
  const timeout = window.setTimeout(() => transition.skipTransition(), TRANSITION_TIMEOUT);
  let animation: Animation | undefined;

  try {
    await transition.ready;
    const frames = getRevealFrames(revealOrigin);
    animation = root.animate(isDark ? frames.reverse() : frames, {
      duration: isDark ? CONCEAL_DURATION : REVEAL_DURATION,
      easing: TRANSITION_EASING,
      pseudoElement: isDark ? '::view-transition-old(root)' : '::view-transition-new(root)',
      fill: 'forwards',
    });
    await transition.finished;
  } catch {
    // Hidden documents and interrupted transitions still commit their requested theme.
    transition.skipTransition();
    await transition.finished.catch(() => {});
  } finally {
    window.clearTimeout(timeout);
    animation?.cancel();
    if (activeTransition === transition) {
      delete root.dataset.themeTransition;
      activeTransition = undefined;
    }
  }
}
