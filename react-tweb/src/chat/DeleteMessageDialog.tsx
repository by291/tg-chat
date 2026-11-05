import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import styles from './overlays.module.css';

interface DeleteMessageDialogProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirm removing a message from the local conversation history. */
export function DeleteMessageDialog({ isOpen, onCancel, onConfirm }: DeleteMessageDialogProps) {
  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(details) => {
        if (!details.open) {
          onCancel();
        }
      }}
      role="alertdialog"
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Positioner className={styles.dialogPositioner}>
          <Dialog.Content className={styles.dialog}>
            <Dialog.Title>Delete message?</Dialog.Title>
            <Dialog.Description>This message will be removed from this device.</Dialog.Description>
            <div className={styles.dialogActions}>
              <Dialog.CloseTrigger className={styles.textButton}>Cancel</Dialog.CloseTrigger>
              <button className={`${styles.textButton} ${styles.danger}`} onClick={onConfirm}>
                Delete
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
