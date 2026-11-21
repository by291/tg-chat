import { X } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { IconButton } from '@/components/IconButton';
import { useHandheldLayout } from '@/layouts/chat/useHandheldLayout';
import { isDismissKey } from '@/lib/keyboardEvent';
import styles from './ChatDetails.module.css';

interface InformationPanelProps {
  title: string;
  closeLabel: string;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Present a focusable information sidebar inside the responsive chat layout. */
export function InformationPanel(props: InformationPanelProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const isHandheld = useHandheldLayout();
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    const panel = closeButton.current?.closest('aside');
    const hasFocus = panel?.contains(document.activeElement);
    // A resize can cover a desktop editor that still holds focus.
    if (props.isOpen && (!wasOpen.current || (isHandheld && !hasFocus))) {
      closeButton.current?.focus({ preventScroll: true });
    }
    wasOpen.current = props.isOpen;
  }, [props.isOpen, isHandheld]);

  return (
    <aside
      className={styles.details}
      aria-label={props.title}
      onKeyDown={(event) => {
        // Portaled menus and confirmations receive their own Escape before this surface.
        if (event.currentTarget.contains(event.target as Node) && isDismissKey(event.nativeEvent)) {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <header className={styles.header}>
        <IconButton ref={closeButton} label={props.closeLabel} onClick={props.onClose}>
          <X />
        </IconButton>
        <h2>{props.title}</h2>
      </header>
      <div className={styles.scrollContent}>{props.children}</div>
    </aside>
  );
}
