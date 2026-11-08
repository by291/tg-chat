import { Portal } from '@ark-ui/react/portal';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getToastSnapshot, hideToast, subscribeToast } from './toastStore';
import styles from './Toast.module.css';

/** Present one centered toast above chats and dialogs, with a shared dismissal policy. */
export function ToastViewport() {
  const toast = useSyncExternalStore(subscribeToast, getToastSnapshot);
  const toastRef = useRef<HTMLDivElement>(null);
  const isVisible = toast?.isVisible ?? false;

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    function dismissOnClick(event: MouseEvent) {
      if (event.target instanceof Node && toastRef.current?.contains(event.target)) {
        return;
      }

      // Pointer dismissal consumes the click; keyboard activation still reaches its control.
      if (event.detail > 0) {
        event.preventDefault();
        event.stopPropagation();
      }

      hideToast();
    }

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      hideToast();
    }

    document.addEventListener('click', dismissOnClick, { capture: true });
    document.addEventListener('contextmenu', dismissOnClick, { capture: true });
    document.addEventListener('keydown', dismissOnEscape, { capture: true });

    return () => {
      document.removeEventListener('click', dismissOnClick, { capture: true });
      document.removeEventListener('contextmenu', dismissOnClick, { capture: true });
      document.removeEventListener('keydown', dismissOnEscape, { capture: true });
    };
  }, [isVisible]);

  return (
    <Portal>
      <div
        className={styles.viewport}
        role={isVisible ? 'status' : undefined}
        aria-live="polite"
        aria-atomic="true"
      >
        {toast && (
          <div
            ref={toastRef}
            className={styles.toast}
            data-visible={isVisible}
            aria-hidden={!isVisible}
          >
            {toast.message}
          </div>
        )}
      </div>
    </Portal>
  );
}
