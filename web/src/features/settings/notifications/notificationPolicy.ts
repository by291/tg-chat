import { CURRENT_USER_ID } from '@/domain/identity';
import { type ChatState } from '@/features/chat/state/chatState';
import { type Conversation } from '@/domain/conversations/conversation';
import { type Message } from '@/domain/messages/message';
import { getConversations } from '@/features/chat/state/conversations';
import { describeMessage } from '@/features/chat/messageFormatting';
import type { NotificationPreferences } from './notificationPreferences';

interface NotificationPolicyOptions {
  state: ChatState;
  preferences: NotificationPreferences;
  message: Message;
  isChatVisible: boolean;
  now: number;
}

/** Share the existing per-chat mute deadline between settings and notification delivery. */
export function isConversationMuted({
  state,
  conversation,
  now,
}: {
  state: ChatState;
  conversation: Conversation;
  now: number;
}) {
  const choice = state.conversationPreferences?.[conversation.id];
  const hasExpired = Boolean(choice?.mutedUntil && choice.mutedUntil <= now);

  return (choice?.isMuted ?? conversation.isMuted ?? false) && !hasExpired;
}

/** Build privacy-aware notification text only for eligible new incoming messages. */
export function resolveMessageNotification({
  state,
  preferences,
  message,
  isChatVisible,
  now,
}: NotificationPolicyOptions) {
  if (message.authorId === CURRENT_USER_ID || message.isService || isChatVisible) {
    return;
  }

  const conversation = getConversations(state).find((entry) => entry.id === message.chatId);
  const isDeleted = state.conversationPreferences?.[message.chatId]?.isDeleted;
  if (!conversation || conversation.kind === 'saved' || isDeleted) {
    return;
  }

  const category = preferences[conversation.kind ?? 'group'];
  const isMuted = isConversationMuted({
    state,
    conversation,
    now,
  });
  if (!category.shouldNotify || isMuted) {
    return;
  }

  let body = 'New message';
  if (category.shouldShowPreview) {
    body = describeMessage(message);
    if (conversation.kind === 'group') {
      body = `${message.authorName}: ${body}`;
    }
  }

  return {
    title: conversation.title,
    body,
    chatId: conversation.id,
  };
}
