import { useSyncExternalStore } from 'react';

const HANDHELD_QUERY = '(max-width: 760px)';

/** Read the breakpoint that switches chat from simultaneous columns to one visible pane. */
export function isHandheldLayout() {
  return window.matchMedia?.(HANDHELD_QUERY).matches ?? false;
}

function subscribeToWidth(notify: () => void) {
  const query = window.matchMedia?.(HANDHELD_QUERY);
  query?.addEventListener('change', notify);
  return () => query?.removeEventListener('change', notify);
}

/** Reevaluate pane ownership when a resize changes the active layout. */
export function useHandheldLayout() {
  return useSyncExternalStore(subscribeToWidth, isHandheldLayout);
}
