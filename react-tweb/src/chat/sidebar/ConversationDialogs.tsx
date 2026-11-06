import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { X } from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import { IconButton } from '../../components/IconButton';
import { describeMessage, formatMessageTime } from '../messageFormatting';
import { CURRENT_USER_ID, type ChatState } from '../model';
import { getDeleteConversationLabel, type ConversationListEntry } from './conversationList';
import type { ConversationConfirmation } from './useSidebarActions';
import overlays from '../overlays.module.css';
import styles from './ConversationDialogs.module.css';

const PREVIEW_MESSAGE_LIMIT = 8;

interface ConversationPreviewProps {
  conversation?: ConversationListEntry;
  state: ChatState;
  onClose: () => void;
  onOpen: (chatId: string) => void;
}

interface ConversationConfirmationProps {
  request?: ConversationConfirmation;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Show recent local messages without selecting the conversation or marking it as read. */
export function ConversationPreview({
  conversation,
  state,
  onClose,
  onOpen,
}: ConversationPreviewProps) {
  const chatMessages = state.messages.filter((message) => message.chatId === conversation?.id);
  const messages = chatMessages.slice(-PREVIEW_MESSAGE_LIMIT);

  return (
    <Dialog.Root
      open={Boolean(conversation)}
      onOpenChange={(details) => {
        if (!details.open) {
          onClose();
        }
      }}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={overlays.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={styles.preview}>
            {conversation && (
              <>
                <header className={styles.header}>
                  <Avatar
                    initials={conversation.initials}
                    color={conversation.color}
                    size="small"
                  />
                  <div>
                    <Dialog.Title>{conversation.title}</Dialog.Title>
                    <Dialog.Description>Preview · {conversation.subtitle}</Dialog.Description>
                  </div>
                  <IconButton label="Close preview" onClick={onClose}>
                    <X />
                  </IconButton>
                </header>
                <div className={styles.messages}>
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      className={styles.message}
                      data-own={message.authorId === CURRENT_USER_ID}
                    >
                      <strong>{message.authorName}</strong>
                      {message.attachment && (
                        <img src={message.attachment.url} alt={message.attachment.name} />
                      )}
                      <p>{describeMessage(message)}</p>
                      <time>{formatMessageTime(message.createdAt)}</time>
                    </article>
                  ))}
                  {messages.length === 0 && <p className={styles.empty}>No messages yet</p>}
                </div>
                <button
                  className={styles.openChat}
                  onClick={() => {
                    onOpen(conversation.id);
                    onClose();
                  }}
                >
                  Open chat
                </button>
              </>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

/** Confirm destructive list actions before removing local history or conversations. */
export function ConversationRemovalDialog({
  request,
  onCancel,
  onConfirm,
}: ConversationConfirmationProps) {
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
      open={Boolean(request)}
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
        <Dialog.Backdrop className={overlays.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={overlays.dialog}>
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
