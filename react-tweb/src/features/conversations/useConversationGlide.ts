import { useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';

const GLIDE_DURATION_MS = 120;

interface ConversationGlideOptions {
  top: number;
  canGlide: boolean;
}

/** Glide a mounted row from its drawn position to its new layout position. */
export function useConversationGlide({ top, canGlide }: ConversationGlideOptions) {
  const rowRef = useRef<HTMLDivElement>(null);
  const previousTopRef = useRef<number | undefined>(undefined);
  const animationRef = useRef<Animation | undefined>(undefined);
  const shouldReduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    const row = rowRef.current;
    const previousTop = previousTopRef.current;
    previousTopRef.current = top;
    const shouldKeepAnimation = previousTop === top && canGlide && !shouldReduceMotion;
    if (!row || shouldKeepAnimation) {
      return;
    }

    // React has committed the new top, but the previous animation still draws its offset.
    const transform = getComputedStyle(row).transform;
    const drawnOffset = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
    const drawnTop = previousTop === undefined ? top : previousTop + drawnOffset;
    animationRef.current?.cancel();
    animationRef.current = undefined;
    delete row.dataset.gliding;

    const shouldAnimate =
      canGlide && previousTop !== undefined && drawnTop !== top && !shouldReduceMotion;
    if (!shouldAnimate) {
      return;
    }

    const animation = row.animate(
      [{ transform: `translateY(${drawnTop - top}px)` }, { transform: 'translateY(0)' }],
      { duration: GLIDE_DURATION_MS, easing: 'ease' },
    );
    animationRef.current = animation;
    row.dataset.gliding = 'true';
    animation.onfinish = () => {
      if (animationRef.current !== animation) {
        return;
      }
      animationRef.current = undefined;
      delete row.dataset.gliding;
    };
  }, [top, canGlide, shouldReduceMotion]);

  useLayoutEffect(() => {
    return () => {
      animationRef.current?.cancel();
      animationRef.current = undefined;
      previousTopRef.current = undefined;
    };
  }, []);

  return rowRef;
}
