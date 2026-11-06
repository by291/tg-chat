import { conversations } from '../demo/fixtures';
import { CURRENT_USER_ID, type ChatState, type Message } from '../model';
import { updateConversations } from './conversationActions';

interface IncomingMessageOptions {
  state: ChatState;
  message: Message;
}

/** Apply a local incoming message and the archive policy without changing the active conversation. */
export function receiveMessage({ state, message }: IncomingMessageOptions): ChatState {
  const conversation = conversations.find((entry) => entry.id === message.chatId);
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
  const isActive = state.activeChatId === message.chatId;
  const updatedState = updateConversations({
    state,
    chatIds: [message.chatId],
    changes: {
      isArchived: shouldLeaveArchive ? false : preferences?.isArchived,
      unreadCount: isActive ? 0 : unreadCount + 1,
      isMarkedUnread: isActive ? false : preferences?.isMarkedUnread,
      hasClearedHistory: false,
    },
  });

  return {
    ...updatedState,
    messages: [...state.messages, { ...message, text: message.text.trim() }],
  };
}
