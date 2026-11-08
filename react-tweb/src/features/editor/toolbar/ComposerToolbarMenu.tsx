import { Popover } from '@ark-ui/react/popover';
import { Portal } from '@ark-ui/react/portal';
import { useState, type ReactNode } from 'react';
import overlays from '@/components/overlays/overlays.module.css';
import styles from './ComposerFormattingToolbar.module.css';

export interface ComposerMenuAction {
  label: string;
  applyEditorChange: () => void;
  isDisabled?: boolean;
}

interface ComposerToolbarMenuProps {
  label: string;
  icon: ReactNode;
  actions: ComposerMenuAction[];
  onCaptureSelection: () => void;
  onRestoreSelection: () => void;
}

/** Display keyboard-accessible block commands without losing the editor selection. */
export function ComposerToolbarMenu({
  label,
  icon,
  actions,
  onCaptureSelection,
  onRestoreSelection,
}: ComposerToolbarMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover.Root
      open={isOpen}
      restoreFocus={false}
      positioning={{ placement: 'top-start', gutter: 8 }}
      onOpenChange={({ open }) => {
        if (open) {
          onCaptureSelection();
        } else {
          onRestoreSelection();
        }
        setIsOpen(open);
      }}
    >
      <Popover.Trigger
        type="button"
        className={styles.button}
        aria-label={label}
        title={label}
        onPointerDown={(event) => event.preventDefault()}
      >
        {icon}
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content className={`${overlays.menu} ${styles.menu}`} aria-label={label}>
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={action.isDisabled}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  action.applyEditorChange();
                  setIsOpen(false);
                }}
              >
                {action.label}
              </button>
            ))}
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
