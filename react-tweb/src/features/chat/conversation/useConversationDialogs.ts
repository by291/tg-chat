import { useState, type Dispatch, type SetStateAction } from 'react';
import type { Conversation } from '@/domain/conversations/conversation';
import type { Message } from '@/domain/messages/message';
import type { MediaViewerCommand } from '@/features/media/mediaViewerCommands';
import type { ChatAction } from '../state/chatActions';
import type { ForwardRecipients } from '../messages/forwarding/ForwardMessageDialog';
import { forwardMessages as sendForwardedMessages } from '../messages/forwarding/forwardMessages';

interface ConversationDialogsOptions {
  chatId: string;
  dispatch: Dispatch<ChatAction>;
  pendingDelete?: Message;
  setPendingDelete: Dispatch<SetStateAction<Message | undefined>>;
  requestedMediaCommand?: MediaViewerCommand;
  onFinishMediaCommand?: (options: { shouldRestoreViewer: boolean }) => void;
  onPrepareForward: (options: { chatId: string; messages: Message[] }) => void;
  onClearReplyAndEdit: () => void;
  onClearDeletedContext: (messageId: string) => void;
  onClearSelection: () => void;
  onNotify: (message: string) => void;
}

/** Coordinate forwarding and deletion confirmations with composer and viewer state. */
export function useConversationDialogs({
  chatId,
  dispatch,
  pendingDelete,
  setPendingDelete,
  requestedMediaCommand,
  onFinishMediaCommand,
  onPrepareForward,
  onClearReplyAndEdit,
  onClearDeletedContext,
  onClearSelection,
  onNotify,
}: ConversationDialogsOptions) {
  const [pendingForward, setPendingForward] = useState<Message[]>();

  function finishMediaDialog(options: {
    action: 'forward' | 'delete';
    shouldRestoreViewer: boolean;
  }) {
    if (requestedMediaCommand?.action !== options.action) {
      return;
    }
    const pendingMessage = options.action === 'delete' ? pendingDelete : pendingForward?.[0];
    // Only the dialog opened by this exact viewer command may complete or restore that viewer.
    if (pendingMessage !== requestedMediaCommand.message) {
      return;
    }
    onFinishMediaCommand?.({ shouldRestoreViewer: options.shouldRestoreViewer });
  }

  function sendToRecipients({ recipients, caption, customEmoji, richText }: ForwardRecipients) {
    if (!pendingForward) {
      return;
    }
    for (const recipient of recipients) {
      sendForwardedMessages({
        messages: pendingForward,
        chatId: recipient.id,
        caption,
        customEmoji,
        richText,
        dispatch,
      });
    }
    finishMediaDialog({ action: 'forward', shouldRestoreViewer: false });
    setPendingForward(undefined);
    onClearSelection();
    onNotify('Messages forwarded');
  }

  function chooseForwardRecipient(recipient: Conversation) {
    if (!pendingForward) {
      return;
    }
    if (recipient.kind === 'saved') {
      sendToRecipients({ recipients: [recipient], caption: '' });
      return;
    }
    // Choosing an ordinary chat creates a draft; only its composer sends the messages.
    onClearReplyAndEdit();
    onPrepareForward({ chatId: recipient.id, messages: pendingForward });
    setPendingForward(undefined);
    onClearSelection();
  }

  function confirmDelete() {
    if (!pendingDelete) {
      return;
    }
    dispatch({
      type: 'delete',
      chatId,
      messageId: pendingDelete.id,
    });
    onClearDeletedContext(pendingDelete.id);

    finishMediaDialog({ action: 'delete', shouldRestoreViewer: false });
    setPendingDelete(undefined);
  }

  function cancelForward() {
    finishMediaDialog({ action: 'forward', shouldRestoreViewer: true });
    setPendingForward(undefined);
  }

  function cancelDelete() {
    finishMediaDialog({ action: 'delete', shouldRestoreViewer: true });
    setPendingDelete(undefined);
  }

  return {
    pendingForward,
    requestForward: setPendingForward,
    chooseForwardRecipient,
    sendToRecipients,
    confirmDelete,
    cancelForward,
    cancelDelete,
  };
}
