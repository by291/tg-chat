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
    if (!existing) {
      messages.set(message.id, message);
      continue;
    }
    const content = compareCounter(message.version, existing.version) >= 0 ? message : existing;
    const interactions =
      compareCounter(message.interaction_version, existing.interaction_version) >= 0
        ? message
        : existing;
    messages.set(message.id, {
      ...content,
      interaction_version: interactions.interaction_version,
      is_pinned: !content.is_deleted && interactions.is_pinned,
      reactions: content.is_deleted ? [] : interactions.reactions,
    });
  }
  const ordered = Array.from(messages.values());
  ordered.sort((first, second) => compareCounter(first.sequence, second.sequence));
  if (options.edge === 'older') {
    return ordered.slice(0, MAX_VISIBLE_MESSAGES);
  }
  return ordered.slice(-MAX_VISIBLE_MESSAGES);
}

/** Remove obsolete reply excerpts when a source edit reaches either cache or visible history. */
export function scrubReplySource(
  messages: CanonicalMessage[],
  source: CanonicalMessage,
): CanonicalMessage[] {
  const current = messages.find((message) => message.id === source.id);
  const authoritative =
    current && compareCounter(current.version, source.version) > 0 ? current : source;
  return messages.map((message) => {
    const reply = message.reply;
    if (
      reply?.message_id !== source.id ||
      !reply.quote ||
      authoritative.content.text.includes(reply.quote)
    ) {
      return message;
    }
    return { ...message, reply: { ...reply, quote: null } };
  });
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
    reactions: message.reactions.map((reaction) => reaction.emoji),
    reactionDetails: message.reactions.map((reaction) => ({
      emoji: reaction.emoji,
      count: reaction.count,
      isSelected: reaction.is_selected,
    })),
    replyToId: message.reply?.message_id,
    isReplyUnavailable: message.reply?.is_unavailable,
    replyQuote:
      message.reply?.quote && !message.reply.is_unavailable
        ? { text: message.reply.quote }
        : undefined,
    isPinned: message.is_pinned,
    isEdited: Boolean(message.edited_at),
    isService: Boolean(message.service_kind),
    expiresAt: message.expires_at ? Date.parse(message.expires_at) : undefined,
    deliveryStatus: 'accepted',
    remoteAttachments: message.attachments,
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
    interaction_version: '0',
    is_deleted: false,
    is_pinned: false,
    reactions: [],
  });

  const totalBytes = pending.media?.reduce((bytes, item) => bytes + item.sizeBytes, 0) ?? 0;
  const progress = pending.mediaProgress;
  let status = 'Waiting to upload';
  if (pending.request.attachments?.length) {
    status = 'Sending message';
  } else if (progress?.phase === 'processing') {
    status = 'Processing attachments';
  } else if (progress && totalBytes > 0) {
    const percentage = Math.round((progress.bytes / totalBytes) * 100);
    status = `Uploading ${Math.min(percentage, 100)}%`;
  }
  if (pending.status === 'failed') {
    status = 'Upload failed';
  }
  const pendingMedia = pending.media
    ? {
        status,
        error: pending.error,
        items: pending.media.map((item) => ({
          occurrenceId: item.occurrenceId,
          filename: item.filename,
          isReady: Boolean(item.fileId),
        })),
      }
    : undefined;

  return { ...message, deliveryStatus: pending.status, pendingMedia };
}
