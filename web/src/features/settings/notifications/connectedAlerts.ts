import { compareCounter } from '@/features/chat/data/messageModels';
import type { components } from '@/api/schema';

type Conversation = Pick<
  components['schemas']['ConversationView'],
  'id' | 'kind' | 'read_through' | 'clear_through' | 'muted_until' | 'generation'
>;
type Message = Pick<
  components['schemas']['CanonicalMessage'],
  'id' | 'author_id' | 'sequence' | 'is_deleted' | 'expires_at' | 'service_kind'
>;

export interface AlertGroup {
  position: string;
  is_new_message?: boolean;
  conversation_id: string;
  conversation?: Conversation | null;
  message?: Message | null;
  removed_message_id?: string | null;
}

interface AlertContext {
  userId: string;
  isForeground: boolean;
  conversations: readonly Conversation[];
  activeConversationId?: string;
  canNotify: (kind: string) => boolean;
}

interface ConnectedAlert {
  conversationId: string;
  messageId: string;
}

function canAlert(input: {
  context: AlertContext;
  conversation: Conversation;
  message: Message;
}): boolean {
  const { context, conversation, message } = input;
  if (
    message.author_id === context.userId ||
    message.is_deleted ||
    message.service_kind ||
    conversation.kind === 'saved' ||
    conversation.id === context.activeConversationId
  ) {
    return false;
  }
  const now = Date.now();
  const isExpired = message.expires_at && Date.parse(message.expires_at) <= now;
  const isMuted = conversation.muted_until && Date.parse(conversation.muted_until) > now;
  const isRead = compareCounter(message.sequence, conversation.read_through) <= 0;
  const isCleared = compareCounter(message.sequence, conversation.clear_through) <= 0;
  return !isExpired && !isMuted && !isRead && !isCleared && context.canNotify(conversation.kind);
}

export class ConnectedAlerts {
  private shouldBaseline = true;
  private lastPosition = '0';

  /** Treat the next complete sync cycle as backfill after a reconnect or cache rebuild. */
  resetBaseline(): void {
    this.shouldBaseline = true;
  }

  /** Deliver only new, still-authorized projections from a completed live sync cycle. */
  completeSync(input: { groups: readonly AlertGroup[]; context: AlertContext }): ConnectedAlert[] {
    const { groups, context } = input;
    const isLive = !this.shouldBaseline && context.isForeground;
    this.shouldBaseline = false;
    if (!groups.length) {
      return [];
    }

    const conversations = new Map(context.conversations.map((entry) => [entry.id, entry]));
    const removedMessages = new Set(groups.map((group) => group.removed_message_id));
    const alerts: ConnectedAlert[] = [];

    for (const group of groups) {
      if (compareCounter(group.position, this.lastPosition) <= 0) {
        continue;
      }
      // Consumption advances independently of policy so later settings cannot replay a message.
      this.lastPosition = group.position;
      const { message } = group;
      const conversation = conversations.get(group.conversation_id);
      if (!isLive || !group.is_new_message || !message || removedMessages.has(message.id)) {
        continue;
      }
      if (!conversation || conversation.generation !== group.conversation?.generation) {
        continue;
      }
      if (canAlert({ context, conversation, message })) {
        alerts.push({ conversationId: conversation.id, messageId: message.id });
      }
    }

    return alerts;
  }
}
