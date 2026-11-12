import type { components } from '@/api/schema';
import type { SessionOwner } from '@/features/auth/SessionOwner';

const audienceFormatter = new Intl.NumberFormat();

export type CommunityKind = 'group' | 'channel';
export type CommunityAction = components['schemas']['CommunityAction'];
export type Conversation = components['schemas']['ConversationView'];

export interface CommunityPanelProps {
  session: SessionOwner;
  conversation: Conversation;
  command: (action: CommunityAction) => Promise<void>;
  confirm: (input: { title: string; description: string; action: CommunityAction }) => void;
}

/** Format the aggregate audience without requiring access to the member roster. */
export function communityAudienceLabel(input: {
  kind: CommunityKind;
  memberCount?: string | null;
}): string {
  const isChannel = input.kind === 'channel';
  if (input.memberCount == null) {
    return isChannel ? 'Channel' : 'Group';
  }

  const count = Number(input.memberCount);
  const noun = isChannel ? 'subscriber' : 'member';
  const suffix = count === 1 ? '' : 's';
  return `${audienceFormatter.format(count)} ${noun}${suffix}`;
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
