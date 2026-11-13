import type { EmojiText } from '@/domain/messages/customEmoji';
import type { Conversation } from './messageModels';
import type { Draft, PendingSnapshot } from './pendingMessages';

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
    replyExpiresAt: server.reply_expires_at ?? undefined,
    isReplyUnavailable: server.is_reply_unavailable ?? false,
  };
}

/** Create a blank draft with its own edit identity. */
export function emptyDraft(): Draft {
  return { id: crypto.randomUUID(), value: { text: '' } };
}

/** Reconcile a stored draft with the current server revision for one destination. */
export function restoreSelectionDraft(input: {
  key: string;
  canonicalDraft?: Conversation['draft'];
  persisted: PendingSnapshot;
}) {
  const { key, canonicalDraft, persisted } = input;
  const remote = canonicalDraft ? restoreServerDraft(canonicalDraft) : emptyDraft();
  remote.replyRevision = persisted.replyRevisions?.[key];
  const storedDraft = persisted.drafts[key];
  let draft = remote;
  if (storedDraft && storedDraft.hasLocalChanges !== false) {
    // Legacy local-only drafts have no dirty marker and must remain recoverable after upgrade.
    draft = { ...storedDraft, hasLocalChanges: true };
  }
  const hasConflict =
    draft.hasLocalChanges &&
    canonicalDraft &&
    (draft.serverVersion ?? '0') !== canonicalDraft.version;

  return {
    draft,
    draftConflict: hasConflict ? remote : undefined,
    draftAlternatives: persisted.draftAlternatives?.[key] ?? [],
  };
}
