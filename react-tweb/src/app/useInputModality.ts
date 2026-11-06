import { useEffect } from 'react';

/** Distinguish keyboard navigation from pointer focus restored by an overlay. */
export function useInputModality() {
  useEffect(() => {
    const root = document.documentElement;

    function onPointerDown() {
      root.dataset.inputMethod = 'pointer';
    }

    function onKeyDown(event: KeyboardEvent) {
      const hasShortcutModifier = event.metaKey || event.ctrlKey || event.altKey;
      if (!hasShortcutModifier) {
        root.dataset.inputMethod = 'keyboard';
      }
    }

    // Capture precedes Ark's handlers, including handlers that stop event propagation.
    const listeners = new AbortController();
    const options = { signal: listeners.signal, capture: true };
    document.addEventListener('pointerdown', onPointerDown, options);
    document.addEventListener('keydown', onKeyDown, options);

    return () => {
      listeners.abort();
      delete root.dataset.inputMethod;
    };
  }, []);
}
