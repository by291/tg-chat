import type { Message } from '@/domain/messages/message';

export const EMPTY_CONVERSATION_MESSAGES: Message[] = [];

export interface ConversationMessageIndex {
  messagesByChatId: ReadonlyMap<string, Message[]>;
  lastMessageByChatId: ReadonlyMap<string, Message>;
}

/** Index each chat's history and preview in their existing persisted order. */
export function indexConversationMessages(messages: Message[]): ConversationMessageIndex {
  const messagesByChatId = new Map<string, Message[]>();
  const lastMessageByChatId = new Map<string, Message>();

  for (const message of messages) {
    let conversationMessages = messagesByChatId.get(message.chatId);
    if (!conversationMessages) {
      conversationMessages = [];
      messagesByChatId.set(message.chatId, conversationMessages);
    }

    conversationMessages.push(message);
    lastMessageByChatId.set(message.chatId, message);
  }

  return { messagesByChatId, lastMessageByChatId };
}
