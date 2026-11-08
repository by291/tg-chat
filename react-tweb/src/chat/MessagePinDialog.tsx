import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { Check } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { Ripple } from '../components/Ripple';
import type { Conversation } from './model';
import type { MessagePinRequest } from './useMessagePinning';
import { useClosingDialogValue } from './sidebar/useClosingDialogValue';
import overlays from './overlays.module.css';
import dialogs from './sidebar/ConversationDialogs.module.css';
import styles from './MessagePinDialog.module.css';

interface MessagePinDialogProps {
  request?: MessagePinRequest;
  conversation: Conversation;
  onCancel: () => void;
  onConfirm: () => void;
}

function getPinDescription(conversation: Conversation) {
  if (conversation.kind === 'channel') {
    return 'Do you want to pin this message in this channel?';
  }
  if (conversation.kind === 'group' || !conversation.kind) {
    return 'Pin this message in the group?';
  }
  return 'Do you want to pin this message at the top of the chat?';
}

/** Confirm the requested pin state with the same popup for every message action entry point. */
export function MessagePinDialog({
  request: openRequest,
  conversation,
  onCancel,
  onConfirm,
}: MessagePinDialogProps) {
  const request = useClosingDialogValue(openRequest);
  const isPinning = request?.isPinned ?? true;
  const title = isPinning ? 'Pin message' : 'Unpin message';
  const isGroup = conversation.kind === 'group' || !conversation.kind;
  const hasRemoteOption = isPinning && (isGroup || conversation.kind === 'private');
  const optionLabel = isGroup ? 'Notify all members' : `Also pin for ${conversation.title}`;

  return (
    <Dialog.Root
      open={Boolean(openRequest)}
      onOpenChange={({ open }) => {
        if (!open) {
          onCancel();
        }
      }}
      role="alertdialog"
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${styles.dialog} ${dialogs.confirmation}`}>
            <header className={styles.header}>
              <Avatar initials={conversation.initials} color={conversation.color} size="small" />
              <Dialog.Title>{title}</Dialog.Title>
            </header>
            <Dialog.Description className={styles.description}>
              {isPinning
                ? getPinDescription(conversation)
                : 'Would you like to unpin this message?'}
            </Dialog.Description>
            {hasRemoteOption && (
              <>
                <label className={styles.option}>
                  <input type="checkbox" checked disabled aria-describedby="pin-backend-notice" />
                  <span className={styles.checkbox} aria-hidden="true">
                    <Check />
                  </span>
                  {optionLabel}
                </label>
                <p id="pin-backend-notice" className={styles.notice}>
                  {isGroup
                    ? 'Member notifications require a backend connection.'
                    : 'Pinning for the other person requires a backend connection.'}
                </p>
              </>
            )}
            <div className={styles.actions}>
              <Dialog.CloseTrigger className={styles.button}>
                Cancel
                <Ripple />
              </Dialog.CloseTrigger>
              <button className={styles.button} data-danger={!isPinning} onClick={onConfirm}>
                {isPinning ? 'Pin' : 'Unpin'}
                <Ripple />
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
