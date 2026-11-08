import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/features/chat/demo/fixtures';
import { indexConversationMessages } from './conversationMessages';

describe('conversation message index', () => {
  it('preserves message order within each chat and selects its last remaining message', () => {
    const originalMessages = createInitialState().messages;
    const firstMessage = originalMessages[0];
    const secondMessage = {
      ...firstMessage,
      id: 'second',
      chatId: 'another-chat',
    };
    const finalMessage = { ...firstMessage, id: 'final' };
    // prettier-ignore
    const messages = [
      firstMessage,
      secondMessage,
      finalMessage,
    ];
    const index = indexConversationMessages(messages);

    expect(index.messagesByChatId.get(firstMessage.chatId)).toEqual([firstMessage, finalMessage]);
    expect(index.messagesByChatId.get(secondMessage.chatId)).toEqual([secondMessage]);
    expect(index.lastMessageByChatId.get(firstMessage.chatId)).toBe(finalMessage);

    const remainingIndex = indexConversationMessages(messages.slice(0, -1));

    expect(remainingIndex.lastMessageByChatId.get(firstMessage.chatId)).toBe(firstMessage);
    expect(remainingIndex.messagesByChatId.has('missing')).toBe(false);
  });
});
