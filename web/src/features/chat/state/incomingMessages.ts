import { getConversations } from './conversations';
import { CURRENT_USER_ID } from '@/domain/identity';
import { type ChatState } from '@/features/chat/state/chatState';
import { type Message } from '@/domain/messages/message';
import { updateConversations } from './conversationActions';

interface IncomingMessageOptions {
  state: ChatState;
  message: Message;
}

/** Apply incoming-message and archive rules without changing the active chat. */
export function receiveMessage({ state, message }: IncomingMessageOptions): ChatState {
  const conversation = getConversations(state).find((entry) => entry.id === message.chatId);
  const isDuplicate = state.messages.some((entry) => entry.id === message.id);
  const hasContent = Boolean(
    message.text.trim() || message.attachment || message.sticker || message.media,
  );
  if (!conversation || isDuplicate || !hasContent || message.authorId === CURRENT_USER_ID) {
    return state;
  }

  const preferences = state.conversationPreferences?.[message.chatId];
  if (preferences?.isDeleted) {
    return state;
  }

  const hasMuteExpired = Boolean(preferences?.mutedUntil && preferences.mutedUntil <= Date.now());
  const isMuted = (preferences?.isMuted ?? conversation.isMuted ?? false) && !hasMuteExpired;
  const shouldLeaveArchive =
    preferences?.isArchived && !isMuted && !state.archivePreferences?.keepUnmutedArchived;
  const unreadCount = preferences?.unreadCount ?? conversation.unreadCount ?? 0;
  const updatedState = updateConversations({
    state,
    chatIds: [message.chatId],
    changes: {
      isArchived: shouldLeaveArchive ? false : preferences?.isArchived,
      // An open chat can be scrolled into history; only its visible timeline can mark it read.
      unreadCount: unreadCount + 1,
      hasClearedHistory: false,
    },
  });

  return {
    ...updatedState,
    messages: [
      ...state.messages,
      {
        ...message,
        text: message.text.trim(),
      },
    ],
  };
}
