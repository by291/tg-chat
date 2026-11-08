import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import type { ComponentProps } from 'react';
import overlays from '@/components/overlays/overlays.module.css';
import dialogs from '@/components/overlays/dialogs.module.css';
import { ChatDetails } from './ChatDetails';
import styles from './SenderProfileDialog.module.css';

type SenderProfileDialogProps = Omit<ComponentProps<typeof ChatDetails>, 'messages'>;

/** Present the existing profile and shared media in Telegram's sidebar-sized modal. */
export function SenderProfileDialog(props: SenderProfileDialogProps) {
  const messages = props.state.messages.filter((message) => {
    return message.chatId === props.conversation.id;
  });
  return (
    <Dialog.Root
      open={props.isOpen}
      onOpenChange={({ open }) => {
        if (!open) {
          props.onClose();
        }
      }}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={`${overlays.dialogPositioner} ${styles.positioner}`}>
          <Dialog.Content
            className={`${dialogs.confirmation} ${styles.dialog}`}
            aria-label="User Info"
          >
            <ChatDetails
              key={props.conversation.id}
              {...props}
              messages={messages}
              shouldManageFocus={false}
            />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
