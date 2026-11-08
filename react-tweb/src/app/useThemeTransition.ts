import { flushSync } from 'react-dom';
import { reserveAnimationPlayback } from '../chat/stickers/stickerPlayback';

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
  prepare?: () => Promise<() => void>;
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
let selectionGeneration = 0;

function animateCircle({ isDark, origin }: { isDark: boolean; origin: ThemeOrigin }) {
  const frames = getRevealFrames(origin);
  return document.documentElement.animate(isDark ? frames.reverse() : frames, {
    duration: isDark ? CONCEAL_DURATION : REVEAL_DURATION,
    easing: TRANSITION_EASING,
    pseudoElement: isDark ? '::view-transition-old(root)' : '::view-transition-new(root)',
    fill: 'forwards',
  });
}

async function animateThemeChange({
  isDark,
  commit,
  origin,
}: {
  isDark: boolean;
  commit: () => void;
  origin?: ThemeOrigin;
}) {
  const root = document.documentElement;
  let effect = 'fade';
  if (origin) {
    effect = isDark ? 'conceal' : 'reveal';
  }
  root.dataset.themeTransition = effect;
  const releasePlayback = reserveAnimationPlayback('theme');
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(commit);
  } catch {
    delete root.dataset.themeTransition;
    releasePlayback();
    commit();
    return;
  }
  activeTransition = transition;
  const timeout = window.setTimeout(() => transition.skipTransition(), TRANSITION_TIMEOUT);
  let animation: Animation | undefined;
  try {
    await transition.ready;
    if (origin && activeTransition === transition) {
      animation = animateCircle({ isDark, origin });
    }
    await transition.finished;
  } catch {
    transition.skipTransition();
    await transition.finished.catch(() => {});
  } finally {
    window.clearTimeout(timeout);
    animation?.cancel();
    releasePlayback();
    if (activeTransition === transition) {
      delete root.dataset.themeTransition;
      activeTransition = undefined;
    }
  }
}

/** Coordinate one prepared appearance change with a fade or an explicit circular reveal. */
export async function runThemeTransition({
  isDark,
  apply,
  prepare,
  origin,
}: ThemeTransitionOptions) {
  selectionGeneration += 1;
  const generation = selectionGeneration;
  activeTransition?.skipTransition();

  let releasePrepared: (() => void) | undefined;
  try {
    // Keep the old view interactive while a new image loads; never snapshot a placeholder.
    if (prepare) {
      releasePrepared = await prepare();
    }
    if (generation !== selectionGeneration) {
      return;
    }

    const commit = () => {
      // Skipped browser transitions can still invoke their update callbacks later.
      if (generation === selectionGeneration) {
        flushSync(apply);
      }
    };
    const shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || shouldReduceMotion) {
      commit();
      return;
    }
    await animateThemeChange({ isDark, commit, origin });
  } finally {
    releasePrepared?.();
  }
}
