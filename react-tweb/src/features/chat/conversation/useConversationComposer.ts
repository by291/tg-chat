import { useCallback, useEffect, useState, type Dispatch } from 'react';
import type { Message } from '@/domain/messages/message';
import type { ChatAction } from '../state/chatActions';
import type { ComposedMessage } from '../composer/MessageComposer';
import type { OutgoingMessageOrigin } from '../messages/transitions/outgoingMessageTransition';
import { forwardMessages as sendForwardedMessages } from '../messages/forwarding/forwardMessages';

interface ConversationComposerOptions {
  chatId: string;
  messages: Message[];
  forwardMessages?: Message[];
  dispatch: Dispatch<ChatAction>;
  onClearForward: () => void;
  onStartContext: () => void;
  onSent: () => void;
  onRequestDelete: (message: Message) => void;
  onPrepareOutgoing: (options: { messageId: string; origin: OutgoingMessageOrigin }) => void;
}

/** Own reply/edit context and submit composer content in the required dispatch order. */
export function useConversationComposer({
  chatId,
  messages,
  forwardMessages,
  dispatch,
  onClearForward,
  onStartContext,
  onSent,
  onRequestDelete,
  onPrepareOutgoing,
}: ConversationComposerOptions) {
  const [replyMessage, setReplyMessage] = useState<Message>();
  const [editingMessage, setEditingMessage] = useState<Message>();

  useEffect(
    () => {
      // Clearing history or expiring a message must not leave an editable copy in the composer.
      if (replyMessage && !messages.some((message) => message.id === replyMessage.id)) {
        setReplyMessage(undefined);
      }
      if (editingMessage && !messages.some((message) => message.id === editingMessage.id)) {
        setEditingMessage(undefined);
      }
    },
    // prettier-ignore
    [
      messages,
      replyMessage,
      editingMessage,
    ],
  );

  const startReply = useCallback(
    (message: Message) => {
      onClearForward();
      onStartContext();
      setReplyMessage(message);
      setEditingMessage(undefined);
    },
    [onClearForward, onStartContext],
  );

  const startEdit = useCallback(
    (message: Message) => {
      onClearForward();
      onStartContext();
      setEditingMessage(message);
      setReplyMessage(undefined);
    },
    [onClearForward, onStartContext],
  );

  function clearReplyAndEdit() {
    setReplyMessage(undefined);
    setEditingMessage(undefined);
  }

  function clearContext() {
    clearReplyAndEdit();
    onClearForward();
  }

  function clearDeletedContext(messageId: string) {
    const isContextDeleted = editingMessage?.id === messageId || replyMessage?.id === messageId;
    if (isContextDeleted) {
      clearContext();
    }
  }

  function submitMessage(composed: ComposedMessage) {
    if (editingMessage) {
      const hasRetainedMedia = Boolean(editingMessage.attachment || editingMessage.media);
      const shouldDelete = !composed.text.trim() && !composed.richText && !hasRetainedMedia;
      if (shouldDelete) {
        // Cancelling deletion keeps the empty editor open so the user can continue the edit.
        onRequestDelete(editingMessage);
        return;
      }
      dispatch({
        type: 'edit',
        chatId,
        messageId: editingMessage.id,
        text: composed.text,
        customEmoji: composed.customEmoji,
        richText: composed.richText,
      });
      clearContext();
      return;
    }

    const hasContent = Boolean(
      composed.text.trim() ||
      composed.richText ||
      composed.attachment ||
      composed.sticker ||
      composed.media,
    );
    if (hasContent) {
      const messageId = crypto.randomUUID();
      if (composed.sendOrigin) {
        // Capture the flight before dispatching clears the draft and mounts the outgoing row.
        onPrepareOutgoing({ messageId, origin: composed.sendOrigin });
      }
      dispatch({
        type: 'send',
        message: {
          id: messageId,
          chatId,
          authorId: 'you',
          authorName: 'You',
          text: composed.text,
          customEmoji: composed.customEmoji,
          richText: composed.richText,
          createdAt: Date.now(),
          attachment: composed.attachment,
          sticker: composed.sticker,
          media: composed.media,
          replyToId: replyMessage?.id,
          reactions: [],
        },
      });
    }
    if (forwardMessages?.length) {
      sendForwardedMessages({
        messages: forwardMessages,
        chatId,
        dispatch,
      });
    }
    clearContext();
    onSent();
  }

  return {
    replyMessage,
    editingMessage,
    startReply,
    startEdit,
    clearReplyAndEdit,
    clearContext,
    clearDeletedContext,
    submitMessage,
  };
}
