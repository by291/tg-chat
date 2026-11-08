import { useLayoutEffect, useRef, useState } from 'react';

const INITIAL_OVERLAY_INSET = 64;
const EDITOR_ROW_CONTENT_HEIGHT = 40;
const MILLISECONDS_PER_SECOND = 1000;

export interface ChatOverlayInsets {
  top: number;
  bottom: number;
  transitionDuration?: number;
}

/** Measure floating controls so history can scroll behind them without hiding its endpoints. */
export function useChatOverlayInsets() {
  const containerRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [insets, setInsets] = useState<ChatOverlayInsets>({
    top: INITIAL_OVERLAY_INSET,
    bottom: INITIAL_OVERLAY_INSET,
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    const header = headerRef.current;
    const footer = footerRef.current;
    if (!container || !header || !footer) {
      return;
    }

    const activeTransitions = new Set<Element>();
    let settleFrame = 0;

    const measureOverlays = (transitionDuration = 0) => {
      // Layout coordinates ignore the profile panel's translation animation.
      const top = header.offsetTop + header.offsetHeight;
      let bottom = container.clientHeight - footer.offsetTop;
      for (const element of activeTransitions) {
        const animation = element.getAnimations().find((candidate) => {
          return candidate instanceof CSSTransition && candidate.transitionProperty === 'height';
        });
        if (!(animation?.effect instanceof KeyframeEffect)) {
          continue;
        }

        const frames = animation.effect.getKeyframes();
        const targetHeight = Number.parseFloat(String(frames.at(-1)?.height));
        if (!Number.isFinite(targetHeight)) {
          continue;
        }

        const currentHeight = element.getBoundingClientRect().height;
        // A single-line editor sits inside a 40px control row; only surplus height grows it.
        const minimum = element.hasAttribute('data-composer') ? EDITOR_ROW_CONTENT_HEIGHT : 0;
        bottom += Math.max(minimum, targetHeight) - Math.max(minimum, currentHeight);
      }
      bottom = Math.round(bottom);
      setInsets((previous) => {
        if (previous.top === top && previous.bottom === bottom) {
          return previous;
        }
        return {
          top,
          bottom,
          transitionDuration,
        };
      });
    };

    function beginTransition(event: TransitionEvent) {
      if (event.propertyName !== 'height' || !(event.target instanceof Element)) {
        return;
      }

      activeTransitions.add(event.target);
      cancelAnimationFrame(settleFrame);
      const duration =
        Number.parseFloat(getComputedStyle(event.target).transitionDuration) *
        MILLISECONDS_PER_SECOND;
      // Publish the destination once. Intermediate CSS frames must not re-render the chat tree.
      measureOverlays(duration);
    }

    function endTransition(event: TransitionEvent) {
      if (event.propertyName !== 'height' || !(event.target instanceof Element)) {
        return;
      }

      activeTransitions.delete(event.target);
      cancelAnimationFrame(settleFrame);
      settleFrame = requestAnimationFrame(() => {
        if (activeTransitions.size === 0) {
          measureOverlays();
        }
      });
    }

    const observer = new ResizeObserver(() => {
      if (activeTransitions.size === 0) {
        measureOverlays();
      }
    });
    footer.addEventListener('transitionrun', beginTransition);
    footer.addEventListener('transitionend', endTransition);
    footer.addEventListener('transitioncancel', endTransition);
    observer.observe(container);
    observer.observe(header);
    observer.observe(footer);
    measureOverlays();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(settleFrame);
      footer.removeEventListener('transitionrun', beginTransition);
      footer.removeEventListener('transitionend', endTransition);
      footer.removeEventListener('transitioncancel', endTransition);
    };
  }, []);

  return {
    containerRef,
    headerRef,
    footerRef,
    insets,
  };
}
