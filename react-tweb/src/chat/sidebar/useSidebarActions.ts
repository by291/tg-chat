import { useState, type Dispatch } from 'react';
import type { ChatAction, ConversationPreferences } from '../model';
import type { ConversationListEntry, ConversationMenuAction } from './conversationList';

export interface ConversationConfirmation {
  mode: 'history' | 'delete';
  conversations: ConversationListEntry[];
}

interface SidebarActionsOptions {
  conversations: ConversationListEntry[];
  dispatch: Dispatch<ChatAction>;
}

/** Coordinate transient menu dialogs and selection with persistent conversation actions. */
export function useSidebarActions({ conversations, dispatch }: SidebarActionsOptions) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<ConversationListEntry>();
  const [confirmation, setConfirmation] = useState<ConversationConfirmation>();
  const selectedConversations = conversations.filter((conversation) => {
    return selectedIds.includes(conversation.id);
  });

  function updateConversation(
    conversation: ConversationListEntry,
    changes: ConversationPreferences,
  ) {
    dispatch({
      type: 'update-conversations',
      chatIds: [conversation.id],
      changes,
    });
  }

  function toggleSelection(chatId: string) {
    setSelectedIds((current) => {
      if (current.includes(chatId)) {
        return current.filter((selectedId) => selectedId !== chatId);
      }
      return [...current, chatId];
    });
  }

  function applySelectionChanges(changes: ConversationPreferences) {
    dispatch({
      type: 'update-conversations',
      chatIds: selectedIds,
      changes,
    });
    setSelectedIds([]);
  }

  function confirmRemoval() {
    if (!confirmation) {
      return;
    }

    dispatch({
      type: 'clear-conversations',
      chatIds: confirmation.conversations.map((conversation) => conversation.id),
      mode: confirmation.mode,
    });
    setConfirmation(undefined);
    setSelectedIds([]);
  }

  function runMenuAction(conversation: ConversationListEntry, action: ConversationMenuAction) {
    switch (action) {
      case 'open-tab': {
        const url = new URL(window.location.href);
        url.searchParams.set('chat', conversation.id);
        window.open(url.href, '_blank', 'noopener,noreferrer');
        return;
      }
      case 'preview':
        setPreview(conversation);
        return;
      case 'select':
        toggleSelection(conversation.id);
        return;
      case 'read':
        updateConversation(conversation, {
          unreadCount: 0,
          isMarkedUnread: !conversation.hasUnread,
        });
        return;
      case 'pin':
        updateConversation(conversation, { isPinned: !conversation.isPinned });
        return;
      case 'mute':
        updateConversation(conversation, { isMuted: !conversation.isMuted });
        return;
      case 'archive':
        updateConversation(conversation, { isArchived: !conversation.isArchived });
        return;
      case 'clear':
        setConfirmation({ mode: 'history', conversations: [conversation] });
        return;
      case 'delete':
        setConfirmation({ mode: 'delete', conversations: [conversation] });
        return;
    }
  }

  return {
    selectedIds,
    selectedConversations,
    preview,
    confirmation,
    toggleSelection,
    applySelectionChanges,
    runMenuAction,
    confirmRemoval,
    clearSelection: () => setSelectedIds([]),
    closePreview: () => setPreview(undefined),
    cancelRemoval: () => setConfirmation(undefined),
    requestSelectionRemoval: () => {
      setConfirmation({ mode: 'delete', conversations: selectedConversations });
    },
  };
}
