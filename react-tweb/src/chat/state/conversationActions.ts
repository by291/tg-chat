import type { ChatState, ConversationPreferences } from '../model';

interface UpdateConversationsOptions {
  state: ChatState;
  chatIds: string[];
  changes: ConversationPreferences;
}

interface ClearConversationsOptions {
  state: ChatState;
  chatIds: string[];
  mode: 'history' | 'delete';
}

interface ReorderPinnedConversationsOptions {
  state: ChatState;
  chatIds: string[];
}

/** Persist the visible pinned order without changing other conversation preferences. */
export function reorderPinnedConversations({ state, chatIds }: ReorderPinnedConversationsOptions) {
  const conversationPreferences = { ...state.conversationPreferences };
  for (const [pinnedOrder, chatId] of chatIds.entries()) {
    conversationPreferences[chatId] = {
      ...conversationPreferences[chatId],
      pinnedOrder,
    };
  }
  return { ...state, conversationPreferences };
}

/** Apply list preferences without losing existing overrides for the same conversation. */
export function updateConversations({ state, chatIds, changes }: UpdateConversationsOptions) {
  const conversationPreferences = { ...state.conversationPreferences };
  for (const chatId of chatIds) {
    conversationPreferences[chatId] = { ...conversationPreferences[chatId], ...changes };
  }

  return { ...state, conversationPreferences };
}

/** Clear local messages and drafts, optionally removing the conversation from the list. */
export function clearConversations({ state, chatIds, mode }: ClearConversationsOptions): ChatState {
  const affectedChatIds = new Set(chatIds);
  const drafts = { ...state.drafts };
  for (const chatId of chatIds) {
    delete drafts[chatId];
  }

  const nextState = updateConversations({
    state,
    chatIds,
    changes: {
      hasClearedHistory: true,
      isDeleted: mode === 'delete',
      unreadCount: 0,
      isMarkedUnread: false,
    },
  });

  return {
    ...nextState,
    drafts,
    messages: state.messages.filter((message) => !affectedChatIds.has(message.chatId)),
  };
}
