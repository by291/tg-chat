import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { getDeleteConversationLabel } from './conversationList';
import type { ConversationConfirmation } from './useSidebarActions';
import overlays from '@/components/overlays/overlays.module.css';
import styles from '@/components/overlays/dialogs.module.css';
import { useClosingDialogValue } from '@/hooks/useClosingDialogValue';

interface ConversationConfirmationProps {
  request?: ConversationConfirmation;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirm destructive list actions before removing local history or conversations. */
export function ConversationRemovalDialog({
  request: openRequest,
  onCancel,
  onConfirm,
}: ConversationConfirmationProps) {
  const request = useClosingDialogValue(openRequest);
  const isDeleting = request?.mode === 'delete';
  const isSingle = request?.conversations.length === 1;
  let title = isDeleting ? 'Delete conversations?' : 'Clear history?';
  if (isDeleting && isSingle && request) {
    title = `${getDeleteConversationLabel(request.conversations[0])}?`;
  }

  let subject = `${request?.conversations.length ?? 0} conversations`;
  if (isSingle && request) {
    subject = `“${request.conversations[0].title}”`;
  }

  return (
    <Dialog.Root
      open={Boolean(openRequest)}
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
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${overlays.dialog} ${styles.confirmation}`}>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>
              {isDeleting
                ? `Remove ${subject} and its messages from this device?`
                : `Clear all messages and drafts in ${subject} on this device?`}
            </Dialog.Description>
            <div className={overlays.dialogActions}>
              <Dialog.CloseTrigger className={overlays.textButton}>Cancel</Dialog.CloseTrigger>
              <button className={`${overlays.textButton} ${overlays.danger}`} onClick={onConfirm}>
                {isDeleting ? 'Delete' : 'Clear history'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
