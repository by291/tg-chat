import type { components } from '@/api/schema';
import type { Message } from '@/domain/messages/message';
import type { PendingMessage } from './pendingMessages';

export type CanonicalMessage = components['schemas']['CanonicalMessage'];
export type Conversation = components['schemas']['ConversationView'];
export type Destination = components['schemas']['Destination'];

export const MAX_VISIBLE_MESSAGES = 200;

/** Compare authoritative decimal counters without browser integer precision loss. */
export function compareCounter(first: string, second: string): number {
  const difference = BigInt(first) - BigInt(second);
  if (difference === 0n) {
    return 0;
  }
  return difference > 0n ? 1 : -1;
}

/** Merge delayed projections monotonically while retaining a bounded sequence window. */
export function mergeMessages(options: {
  current: CanonicalMessage[];
  incoming: CanonicalMessage[];
  edge: 'older' | 'latest';
}): CanonicalMessage[] {
  const messages = new Map(options.current.map((message) => [message.id, message]));
  for (const message of options.incoming) {
    const existing = messages.get(message.id);
    if (!existing || compareCounter(message.version, existing.version) >= 0) {
      messages.set(message.id, message);
    }
  }
  const ordered = Array.from(messages.values());
  ordered.sort((first, second) => compareCounter(first.sequence, second.sequence));
  if (options.edge === 'older') {
    return ordered.slice(0, MAX_VISIBLE_MESSAGES);
  }
  return ordered.slice(-MAX_VISIBLE_MESSAGES);
}

/** Give draft and pending records stable destination ownership before a conversation exists. */
export function destinationKey(destination: Destination): string {
  switch (destination.kind) {
    case 'saved':
      return 'saved';
    case 'recipient':
      return `recipient:${destination.user_id}`;
    case 'conversation':
      return `conversation:${destination.conversation_id}`;
  }
}

/** Adapt accepted transport content to the existing renderer without demo state. */
export function renderMessage(message: CanonicalMessage): Message {
  return {
    id: message.id,
    chatId: message.conversation_id,
    authorId: message.author_id,
    authorName: message.author_name,
    text: message.content.text,
    richText: message.content.rich_text ?? undefined,
    customEmoji: message.content.custom_emoji.map((entity) => ({
      documentId: entity.document_id,
      offset: entity.offset,
      length: entity.length,
    })),
    createdAt: Date.parse(message.created_at),
    reactions: [],
    deliveryStatus: 'accepted',
  };
}

/** Render a durable local operation using the same row key it will have after acceptance. */
export function renderPending(options: {
  pending: PendingMessage;
  user: { id: string; display_name: string };
  conversationId: string;
}): Message {
  const { pending, user, conversationId } = options;
  const message = renderMessage({
    id: pending.request.message_id,
    conversation_id: conversationId,
    author_id: user.id,
    author_name: user.display_name,
    content: pending.request.content,
    created_at: new Date(pending.createdAt).toISOString(),
    sequence: '0',
    version: '0',
  });

  return { ...message, deliveryStatus: pending.status };
}
