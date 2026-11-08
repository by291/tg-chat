import { conversations } from '../demo/fixtures';
import type { ChatState } from '@/features/chat/state/chatState';
import type { Conversation } from '@/domain/conversations/conversation';

/** Merge local conversations and profile edits with the original demonstration catalog. */
export function getConversations(state: Pick<ChatState, 'localConversations'>): Conversation[] {
  const localConversations = state.localConversations ?? [];
  const localIds = new Set(localConversations.map((conversation) => conversation.id));
  const originalConversations = conversations.filter(
    (conversation) => !localIds.has(conversation.id),
  );
  return [...localConversations, ...originalConversations];
}
