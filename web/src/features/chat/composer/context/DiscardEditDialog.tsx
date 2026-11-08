import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useRef } from 'react';
import { Ripple } from '@/components/Ripple';
import overlays from '@/components/overlays/overlays.module.css';
import dialogs from '@/components/overlays/dialogs.module.css';

interface DiscardEditDialogProps {
  isOpen: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
  finalFocusEl: () => HTMLElement | null;
}

/** Protect unsaved message edits while keeping Escape and outside dismissal non-destructive. */
export function DiscardEditDialog({
  isOpen,
  onKeepEditing,
  onDiscard,
  finalFocusEl,
}: DiscardEditDialogProps) {
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog.Root
      open={isOpen}
      role="alertdialog"
      initialFocusEl={() => keepEditingRef.current}
      finalFocusEl={finalFocusEl}
      onOpenChange={({ open }) => {
        if (!open) {
          onKeepEditing();
        }
      }}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${overlays.dialog} ${dialogs.confirmation}`}>
            <Dialog.Title>Discard changes?</Dialog.Title>
            <Dialog.Description>Are you sure you want to discard your changes?</Dialog.Description>
            <div className={overlays.dialogActions}>
              <Dialog.CloseTrigger ref={keepEditingRef} className={overlays.textButton}>
                Keep editing
                <Ripple />
              </Dialog.CloseTrigger>
              <button className={`${overlays.textButton} ${overlays.danger}`} onClick={onDiscard}>
                Discard
                <Ripple />
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
