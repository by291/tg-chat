const TOAST_DURATION = 3000;
// Retain the element until its CSS exit animation has finished.
const TOAST_REMOVAL_DELAY = 200;

interface ToastSnapshot {
  message: string;
  isVisible: boolean;
}

const listeners = new Set<() => void>();
let snapshot: ToastSnapshot | null = null;
let lifetimeTimer: ReturnType<typeof setTimeout> | undefined;
let removalTimer: ReturnType<typeof setTimeout> | undefined;

function publish(next: ToastSnapshot | null) {
  snapshot = next;

  for (const notify of listeners) {
    notify();
  }
}

/** Read the shared toast without tying its lifetime to the control that triggered it. */
export function getToastSnapshot() {
  return snapshot;
}

/** Subscribe the application overlay to the single active notification. */
export function subscribeToast(notify: () => void) {
  listeners.add(notify);

  return () => listeners.delete(notify);
}

/** Fade the active toast before releasing its element. */
export function hideToast() {
  if (!snapshot?.isVisible) {
    return;
  }

  clearTimeout(lifetimeTimer);
  publish({ ...snapshot, isVisible: false });
  removalTimer = setTimeout(() => publish(null), TOAST_REMOVAL_DELAY);
}

/** Replace the active notification and restart its lifetime, including identical messages. */
export function showToast(message: string) {
  if (!message) {
    hideToast();
    return;
  }

  clearTimeout(lifetimeTimer);
  clearTimeout(removalTimer);
  publish({ message, isVisible: true });
  lifetimeTimer = setTimeout(hideToast, TOAST_DURATION);
}
