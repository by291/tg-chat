import { useLayoutEffect, useRef, type ReactNode } from 'react';
import styles from './SidebarNavigation.module.css';

interface SidebarNavigationProps {
  isSecondaryOpen: boolean;
  primary: ReactNode;
  secondary: ReactNode;
}

/** Slide between sidebar pages while preserving their contents, scroll positions, and focus. */
export function SidebarNavigation({ isSecondaryOpen, primary, secondary }: SidebarNavigationProps) {
  const primaryRef = useRef<HTMLDivElement>(null);
  const secondaryRef = useRef<HTMLDivElement>(null);
  const primaryFocusRef = useRef<HTMLElement | null>(null);
  const previousOpenRef = useRef(isSecondaryOpen);

  useLayoutEffect(() => {
    if (previousOpenRef.current === isSecondaryOpen) {
      return;
    }

    previousOpenRef.current = isSecondaryOpen;

    const destination = isSecondaryOpen ? secondaryRef.current : primaryRef.current;
    const availableButtons = Array.from(destination?.querySelectorAll<HTMLElement>('button') ?? []);
    let focusTarget = availableButtons.find((button) => !button.closest('[inert]'));
    const canRestorePrimaryFocus =
      !isSecondaryOpen &&
      primaryFocusRef.current?.isConnected &&
      !primaryFocusRef.current.closest('[inert]');
    if (canRestorePrimaryFocus) {
      focusTarget = primaryFocusRef.current ?? undefined;
    }

    focusTarget?.focus({ preventScroll: true });
  }, [isSecondaryOpen]);

  return (
    <div className={styles.navigation} data-secondary-open={isSecondaryOpen}>
      <div
        ref={primaryRef}
        className={`${styles.page} ${styles.primary}`}
        data-active={!isSecondaryOpen}
        inert={isSecondaryOpen}
        aria-hidden={isSecondaryOpen}
        onFocusCapture={(event) => {
          // Only controls restore focus; returning must not reopen search through input focus.
          if (event.target instanceof HTMLButtonElement) {
            primaryFocusRef.current = event.target;
          }
        }}
      >
        {primary}
      </div>
      <div
        ref={secondaryRef}
        className={`${styles.page} ${styles.secondary}`}
        data-active={isSecondaryOpen}
        inert={!isSecondaryOpen}
        aria-hidden={!isSecondaryOpen}
      >
        {secondary}
      </div>
    </div>
  );
}
