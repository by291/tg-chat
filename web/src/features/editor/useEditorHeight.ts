import { useLayoutEffect, useRef, type RefObject } from 'react';

const HEIGHT_DURATION_FACTOR = 50;
const EXPAND_DURATION = 250;

interface EditorHeightOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLDivElement | null>;
  isEnabled: boolean;
  isExpanded: boolean;
  onHeightChange?: (height: number) => void;
}

/** Animate the shell from the independently measured editable content, without remounting it. */
export function useEditorHeight({
  containerRef,
  inputRef,
  isEnabled,
  isExpanded,
  onHeightChange,
}: EditorHeightOptions) {
  const previousHeightRef = useRef<number | null>(null);
  const wasExpandedRef = useRef(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const input = inputRef.current;
    if (!isEnabled || !container || !input) {
      return;
    }

    if (isExpanded) {
      wasExpandedRef.current = true;
      container.style.transitionDuration = `${EXPAND_DURATION}ms`;
      container.style.height = 'var(--expanded-editor-height)';
      return;
    }

    function measure(measuredHeight?: number) {
      if (!container || !input) {
        return;
      }

      // Observe the input, not the animated shell, to avoid measuring our own transition frames.
      const height = Math.ceil(measuredHeight ?? input.getBoundingClientRect().height);
      const previousHeight = previousHeightRef.current;
      if (height === previousHeight && !wasExpandedRef.current) {
        return;
      }
      const difference = Math.abs(height - (previousHeight ?? height));
      let duration = 0;
      if (difference > 1 && previousHeight !== null) {
        duration = Math.round(HEIGHT_DURATION_FACTOR * Math.log(difference));
      }
      if (wasExpandedRef.current) {
        duration = EXPAND_DURATION;
      }

      container.style.transitionDuration = `${duration}ms`;
      container.style.height = `${height}px`;
      previousHeightRef.current = height;
      wasExpandedRef.current = false;
      onHeightChange?.(height);
    }

    measure();
    const observer = new ResizeObserver((entries) => {
      measure(entries[0]?.borderBoxSize[0]?.blockSize);
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [containerRef, inputRef, isEnabled, isExpanded, onHeightChange]);
}
