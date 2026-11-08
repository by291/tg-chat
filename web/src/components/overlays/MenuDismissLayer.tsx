import { Portal } from '@ark-ui/react/portal';
import type { MouseEvent, ReactNode } from 'react';
import styles from './overlays.module.css';

interface MenuDismissLayerProps {
  isOpen: boolean;
  label: string;
  onDismiss: () => void;
  children: ReactNode;
}

/** Consume outside clicks so dismissing a menu never activates the control underneath. */
export function MenuDismissLayer({ isOpen, label, onDismiss, children }: MenuDismissLayerProps) {
  function dismissMenu(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onDismiss();
  }

  return (
    <Portal>
      <div className={styles.menuLayer}>
        {isOpen && (
          <button
            type="button"
            className={styles.menuDismissTarget}
            aria-label={label}
            tabIndex={-1}
            onPointerDown={(event) => event.preventDefault()}
            onClick={dismissMenu}
            onContextMenu={dismissMenu}
          />
        )}
        {children}
      </div>
    </Portal>
  );
}
