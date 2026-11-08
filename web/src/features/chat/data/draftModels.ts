import type { EmojiText } from '@/domain/messages/customEmoji';
import type { Conversation } from './messageModels';
import type { Draft } from './pendingMessages';

/** Convert a synchronized draft without sharing server objects with the active editor. */
export function restoreServerDraft(server: Conversation['draft']): Draft {
  const content = server.content;
  const value: EmojiText = {
    text: content?.text ?? '',
    richText: content?.rich_text ?? undefined,
    customEmoji: content?.custom_emoji.map((entity) => ({
      documentId: entity.document_id,
      offset: entity.offset,
      length: entity.length,
    })),
  };
  return {
    id: crypto.randomUUID(),
    serverVersion: server.version,
    hasLocalChanges: false,
    value,
    reply: server.reply ?? undefined,
  };
}
