import type { Conversation } from '../data/messageModels';

/** Read the directory label for a canonical conversation. */
export function conversationTitle(conversation: Conversation): string {
  if (conversation.kind === 'saved') {
    return 'Saved Messages';
  }
  return conversation.title || conversation.peer_name;
}
