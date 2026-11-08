import { useState, type Dispatch } from 'react';
import type { ChatAction } from '@/features/chat/state/chatActions';
import type { ChatState } from '@/features/chat/state/chatState';
import type { ArchiveMenuAction } from './ArchiveMenu';
import type { ConversationListEntry } from '../conversationList';

const READ_CONFIRMATION_THRESHOLD = 1000;

export type ArchiveConfirmation = 'read' | 'discard-settings';

interface ArchiveActionsOptions {
  state: ChatState;
  conversations: ConversationListEntry[];
  dispatch: Dispatch<ChatAction>;
  onSearch: () => void;
}

/** Coordinate archive menu commands, persisted preferences, and unsaved settings. */
export function useArchiveActions({
  state,
  conversations,
  dispatch,
  onSearch,
}: ArchiveActionsOptions) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<ArchiveConfirmation>();
  const [keepUnmutedArchived, setKeepUnmutedArchived] = useState(false);
  const isShownInChatList = state.archivePreferences?.showInChatList ?? true;
  const savedKeepUnmutedArchived = state.archivePreferences?.keepUnmutedArchived ?? false;
  const hasSettingsChanges = keepUnmutedArchived !== savedKeepUnmutedArchived;
  const unreadConversations = conversations.filter((conversation) => conversation.hasUnread);

  function markAllAsRead() {
    dispatch({
      type: 'update-conversations',
      chatIds: unreadConversations.map((conversation) => conversation.id),
      changes: { unreadCount: 0, isMarkedUnread: false },
    });
    setConfirmation(undefined);
  }

  function openSettings() {
    setKeepUnmutedArchived(savedKeepUnmutedArchived);
    setIsHelpOpen(false);
    setIsSettingsOpen(true);
  }

  function saveSettings() {
    dispatch({
      type: 'update-archive-preferences',
      changes: { keepUnmutedArchived },
    });
    setConfirmation(undefined);
    setIsSettingsOpen(false);
  }

  function requestCloseSettings() {
    if (hasSettingsChanges) {
      setConfirmation('discard-settings');
      return;
    }

    setIsSettingsOpen(false);
  }

  function discardSettings() {
    setConfirmation(undefined);
    setIsSettingsOpen(false);
  }

  function runAction(action: ArchiveMenuAction) {
    switch (action) {
      case 'search':
        onSearch();
        return;
      case 'visibility':
        dispatch({
          type: 'update-archive-preferences',
          changes: { showInChatList: !isShownInChatList },
        });
        return;
      case 'read':
        if (unreadConversations.length > READ_CONFIRMATION_THRESHOLD) {
          setConfirmation('read');
          return;
        }
        markAllAsRead();
        return;
      case 'settings':
        openSettings();
        return;
      case 'help':
        setIsHelpOpen(true);
        return;
    }
  }

  return {
    isShownInChatList,
    unreadCount: unreadConversations.length,
    isHelpOpen,
    isSettingsOpen,
    keepUnmutedArchived,
    hasSettingsChanges,
    confirmation,
    runAction,
    openSettings,
    saveSettings,
    requestCloseSettings,
    discardSettings,
    markAllAsRead,
    changeSettings: (options: { keepUnmutedArchived: boolean }) => {
      setKeepUnmutedArchived(options.keepUnmutedArchived);
    },
    closeHelp: () => setIsHelpOpen(false),
    cancelConfirmation: () => setConfirmation(undefined),
  };
}
