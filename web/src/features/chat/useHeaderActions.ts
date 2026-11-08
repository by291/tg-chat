import { useCallback, useEffect, useState, type Dispatch } from 'react';
import type { HeaderAction } from './ChatHeaderMenu';
import type { ChatAction } from '@/features/chat/state/chatActions';
import type { ChatState } from '@/features/chat/state/chatState';
import type { Conversation } from '@/domain/conversations/conversation';
import { useConversationDirectory } from '@/features/conversations/ConversationDirectory';
import { useSidebarActions } from '@/features/conversations/useSidebarActions';

const EMPTY_SELECTION: string[] = [];

interface HeaderActionsOptions {
  conversation: Conversation;
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  onNotify: (message: string) => void;
}

/** Share persisted conversation actions with the list, keeping message selection local. */
export function useHeaderActions({ conversation, dispatch, onNotify }: HeaderActionsOptions) {
  const { entries: conversations, entriesById } = useConversationDirectory();
  const entry = entriesById.get(conversation.id);
  const actions = useSidebarActions({ conversations, dispatch });
  const [selection, setSelection] = useState<string[]>();
  const isSelecting = selection !== undefined;
  const selectedIds = selection ?? EMPTY_SELECTION;
  const [dialog, setDialog] = useState<'call' | 'auto-delete' | 'delete-messages'>();

  const clearSelection = useCallback(() => {
    setSelection(undefined);
  }, []);

  const toggleMessage = useCallback((messageId: string) => {
    setSelection((current = []) => {
      if (!current.includes(messageId)) {
        return [...current, messageId];
      }

      const remaining = current.filter((id) => id !== messageId);
      return remaining.length ? remaining : undefined;
    });
  }, []);

  const selectMessage = useCallback((messageId: string) => {
    setSelection((current = []) => {
      return current.includes(messageId) ? current : [...current, messageId];
    });
  }, []);

  const setMessagesSelected = useCallback(
    (options: { messageIds: string[]; shouldSelect: boolean }) => {
      setSelection((current = []) => {
        const next = new Set(current);
        for (const messageId of options.messageIds) {
          if (options.shouldSelect) {
            next.add(messageId);
          } else {
            next.delete(messageId);
          }
        }
        return next.size ? [...next] : undefined;
      });
    },
    [],
  );

  useEffect(() => {
    if (!isSelecting) {
      return;
    }

    function exitWithEscape(event: KeyboardEvent) {
      // Nested menus and dialogs consume Escape before the selection layer.
      if (event.key === 'Escape' && !event.defaultPrevented) {
        clearSelection();
      }
    }
    window.addEventListener('keydown', exitWithEscape);

    return () => window.removeEventListener('keydown', exitWithEscape);
  }, [isSelecting, clearSelection]);

  function runAction(action: HeaderAction) {
    if (action === 'select') {
      setSelection(isSelecting ? undefined : []);
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
    dispatch({
      type: 'delete-messages',
      chatId: conversation.id,
      messageIds: selectedIds,
    });
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
    selectMessage,
    setMessagesSelected,
    runAction,
    setAutoDelete,
    deleteSelectedMessages,
  };
}
