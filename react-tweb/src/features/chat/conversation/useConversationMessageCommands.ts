import { useCallback, useMemo, type Dispatch } from 'react';
import type { Message } from '@/domain/messages/message';
import type { MessageInteraction } from '@/domain/messages/interaction';
import type { ChatAction } from '../state/chatActions';
import type { MessageCommand } from '../messages/commands';
import type { useHeaderActions } from '../useHeaderActions';
import { describeMessage } from '../messageFormatting';
import { downloadMessageMedia } from '../messages/messageDownloads';

interface ConversationMessageCommandsOptions {
  chatId: string;
  messages: Message[];
  dispatch: Dispatch<ChatAction>;
  headerActions: ReturnType<typeof useHeaderActions>;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onDelete: (message: Message) => void;
  onForward: (messages: Message[]) => void;
  onPin: (message: Message) => void;
  onNotify: (message: string) => void;
}

/** Route timeline commands through the selected conversation's action owners. */
export function useConversationMessageCommands({
  chatId,
  messages,
  dispatch,
  headerActions,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onPin,
  onNotify,
}: ConversationMessageCommandsOptions) {
  const { selectedIds, clearSelection, selectMessage, setDialog } = headerActions;
  const selectedMessages = useMemo(() => {
    return messages.filter((message) => selectedIds.includes(message.id));
  }, [messages, selectedIds]);

  const copySelectedMessages = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(selectedMessages.map(describeMessage).join('\n'));
      onNotify('Copied to clipboard');
    } catch {
      onNotify('Could not access the clipboard');
    }
  }, [selectedMessages, onNotify]);

  const copyMessage = useCallback(
    async (message: Message) => {
      try {
        await navigator.clipboard.writeText(describeMessage(message));
        onNotify('Copied to clipboard');
      } catch {
        onNotify('Could not access the clipboard. Select the message text to copy it.');
      }
    },
    [onNotify],
  );

  const forwardSelectedMessages = useCallback(() => {
    onForward(selectedMessages);
  }, [onForward, selectedMessages]);

  // Stable callbacks let memoized history ignore draft and composer-only state changes.
  const applyMessageCommand = useCallback(
    ({ action, message }: MessageCommand) => {
      switch (action) {
        case 'reply':
          onReply(message);
          return;
        case 'edit':
          onEdit(message);
          return;
        case 'clear-selection':
          clearSelection();
          return;
        case 'copy-selected':
          void copySelectedMessages();
          return;
        case 'forward-selected':
          forwardSelectedMessages();
          return;
        case 'download-selected':
          downloadMessageMedia(selectedMessages);
          return;
        case 'delete-selected':
          setDialog('delete-messages');
          return;
        case 'delete':
          onDelete(message);
          return;
        case 'copy':
          void copyMessage(message);
          return;
        case 'select':
          selectMessage(message.id);
          return;
        case 'forward':
          onForward([message]);
          return;
        case 'pin':
          onPin(message);
      }
    },
    [
      onReply,
      onEdit,
      clearSelection,
      copySelectedMessages,
      forwardSelectedMessages,
      selectedMessages,
      setDialog,
      onDelete,
      copyMessage,
      selectMessage,
      onForward,
      onPin,
    ],
  );

  const reactToMessage = useCallback(
    (messageId: string, emoji: string) => {
      dispatch({
        type: 'react',
        chatId,
        messageId,
        emoji,
      });
    },
    [dispatch, chatId],
  );

  const interactWithMessage = useCallback(
    (messageId: string, interaction: MessageInteraction) => {
      dispatch({
        type: 'interact',
        chatId,
        messageId,
        interaction,
      });
    },
    [dispatch, chatId],
  );

  return {
    applyMessageCommand,
    forwardSelectedMessages,
    reactToMessage,
    interactWithMessage,
  };
}
