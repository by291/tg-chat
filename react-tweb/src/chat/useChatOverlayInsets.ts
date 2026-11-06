import { useLayoutEffect, useRef, useState } from 'react';

const INITIAL_OVERLAY_INSET = 64;

export interface ChatOverlayInsets {
  top: number;
  bottom: number;
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

    const measureOverlays = () => {
      // Layout coordinates ignore the profile panel's translation animation.
      const top = header.offsetTop + header.offsetHeight;
      const bottom = container.clientHeight - footer.offsetTop;
      setInsets((previous) => {
        if (previous.top === top && previous.bottom === bottom) {
          return previous;
        }
        return { top, bottom };
      });
    };

    const observer = new ResizeObserver(measureOverlays);
    observer.observe(container);
    observer.observe(header);
    observer.observe(footer);
    measureOverlays();
    return () => observer.disconnect();
  }, []);

  return {
    containerRef,
    headerRef,
    footerRef,
    insets,
  };
}
