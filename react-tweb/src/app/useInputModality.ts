import { useEffect } from 'react';

const NAVIGATION_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);
const TEXT_EDITOR_SELECTOR =
  'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"], [contenteditable="plaintext-only"]';

/** Distinguish keyboard navigation from pointer focus restored by an overlay. */
export function useInputModality() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.inputMethod = 'pointer';

    function onPointerDown() {
      root.dataset.inputMethod = 'pointer';
    }

    function onKeyDown(event: KeyboardEvent) {
      const hasShortcutModifier = event.metaKey || event.ctrlKey || event.altKey;
      if (hasShortcutModifier || !NAVIGATION_KEYS.has(event.key)) {
        return;
      }

      // Typing and moving a caret do not turn a pointer-opened form into keyboard navigation.
      const target = event.target;
      const isEditingText = Boolean(
        target instanceof Element && target.closest(TEXT_EDITOR_SELECTOR),
      );
      if (isEditingText && event.key !== 'Tab') {
        return;
      }
      root.dataset.inputMethod = 'keyboard';
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
