import { useEffect, type Dispatch } from 'react';
import type { ChatAction } from '@/features/chat/state/chatActions';
import type { ChatState } from '@/features/chat/state/chatState';
import { getConversations } from '@/features/chat/state/conversations';

interface ChatRouteOptions {
  chatId: string;
  isReady: boolean;
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
}

/** Apply URL selection after hydration without reviving deleted or unknown conversations. */
export function useChatRoute({ chatId, isReady, state, dispatch }: ChatRouteOptions) {
  const isKnownConversation = getConversations(state).some((entry) => entry.id === chatId);
  const isDeleted = state.conversationPreferences?.[chatId]?.isDeleted ?? false;
  const nextChatId = isKnownConversation && !isDeleted ? chatId : '';

  useEffect(
    () => {
      if (!isReady) {
        return;
      }
      // Explicit selections may commit before Router's transition. Only a changed route should
      // apply URL selection, or the old URL would immediately undo the user's selection.
      dispatch({ type: 'select-chat', chatId: nextChatId });
    },
    // prettier-ignore
    [
    isReady,
    nextChatId,
    dispatch,
  ],
  );
}
