import { useCallback, useState, type Dispatch } from 'react';
import type { HeaderAction } from './ChatHeaderMenu';
import type { ChatAction, ChatState, Conversation } from './model';
import { useConversationList } from './sidebar/conversationList';
import { useSidebarActions } from './sidebar/useSidebarActions';

interface HeaderActionsOptions {
  conversation: Conversation;
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  onNotify: (message: string) => void;
}

/** Share persisted conversation actions with the list, keeping message selection local. */
export function useHeaderActions({
  conversation,
  state,
  dispatch,
  onNotify,
}: HeaderActionsOptions) {
  const conversations = useConversationList(state);
  const entry = conversations.find((item) => item.id === conversation.id);
  const actions = useSidebarActions({ conversations, dispatch });
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dialog, setDialog] = useState<'call' | 'auto-delete' | 'delete-messages'>();

  function clearSelection() {
    setIsSelecting(false);
    setSelectedIds([]);
  }

  const toggleMessage = useCallback((messageId: string) => {
    setSelectedIds((current) => {
      if (current.includes(messageId)) {
        return current.filter((id) => id !== messageId);
      }
      return [...current, messageId];
    });
  }, []);

  function runAction(action: HeaderAction) {
    if (action === 'select') {
      setIsSelecting(!isSelecting);
      setSelectedIds([]);
      return;
    }
    if (action === 'call' || action === 'auto-delete') {
      setDialog(action);
      return;
    }
    if (entry) {
      actions.runMenuAction(entry, action);
    }
  }

  function setAutoDelete(days: number) {
    dispatch({
      type: 'update-conversations',
      chatIds: [conversation.id],
      changes: { autoDeleteDays: days },
    });
    setDialog(undefined);
    onNotify(days ? `New messages will auto-delete after ${days} days` : 'Auto-delete disabled');
  }

  function deleteSelectedMessages() {
    for (const messageId of selectedIds) {
      dispatch({ type: 'delete', chatId: conversation.id, messageId });
    }
    clearSelection();
    setDialog(undefined);
  }

  return {
    entry,
    actions,
    isSelecting,
    selectedIds,
    dialog,
    setDialog,
    clearSelection,
    toggleMessage,
    runAction,
    setAutoDelete,
    deleteSelectedMessages,
  };
}
