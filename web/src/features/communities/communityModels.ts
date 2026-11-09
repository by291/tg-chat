import type { components } from '@/api/schema';
import type { SessionOwner } from '@/features/auth/SessionOwner';

export type CommunityAction = components['schemas']['CommunityAction'];
export type Conversation = components['schemas']['ConversationView'];

export interface CommunityPanelProps {
  session: SessionOwner;
  conversation: Conversation;
  command: (action: CommunityAction) => Promise<void>;
  confirm: (input: { title: string; description: string; action: CommunityAction }) => void;
}

/** Preserve direct-chat draft ownership while selecting shared conversations by canonical ID. */
export function conversationDestination(
  conversation: Conversation,
): components['schemas']['Destination'] {
  if (conversation.kind === 'saved') {
    return { kind: 'saved' };
  }
  if (conversation.kind === 'direct') {
    return { kind: 'recipient', user_id: conversation.peer_id };
  }
  return { kind: 'conversation', conversation_id: conversation.id };
}
