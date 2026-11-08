import { get, update } from 'idb-keyval';
import type { components } from '@/api/schema';
import type { EmojiText } from '@/domain/messages/customEmoji';

const MAX_PENDING_MESSAGES = 100;
const MAX_DRAFTS = 201;
const MAX_DRAFT_ALTERNATIVES = 5;

export interface PendingMessage {
  request: components['schemas']['SendMessage'];
  createdAt: number;
  title?: string;
  status: 'queued' | 'sending' | 'failed';
  error?: string;
}

export interface PendingCommand {
  request: components['schemas']['MessageCommand'];
  createdAt: number;
}

export interface Draft {
  id: string;
  value: EmojiText;
  serverVersion?: string;
  hasLocalChanges?: boolean;
  reply?: components['schemas']['ReplyInput'];
}

export interface PendingSnapshot {
  isActive: boolean;
  pending: PendingMessage[];
  drafts: Record<string, Draft>;
  draftAlternatives?: Record<string, Draft[]>;
  commands?: PendingCommand[];
}

interface EnqueueOptions {
  message: PendingMessage;
  draft?: { destination: string; id: string };
}

function emptySnapshot(): PendingSnapshot {
  return {
    isActive: true,
    pending: [],
    drafts: {},
  };
}

function requireActive(snapshot: PendingSnapshot | undefined): PendingSnapshot {
  if (!snapshot?.isActive) {
    throw new DOMException('Pending ownership has ended.', 'AbortError');
  }

  return snapshot;
}

export class PendingMessages {
  private readonly key: string;
  private isClosed = false;

  /** Namespace pending content by deployment, account, and authoritative session identity. */
  constructor({ key }: { key: string }) {
    this.key = `tg-chat:pending:v1:${key}`;
  }

  /** Recover prior work without reviving a session that has already been invalidated. */
  async open(): Promise<PendingSnapshot> {
    this.ensureOpen();
    await update<PendingSnapshot>(this.key, (existing) => {
      this.ensureOpen();
      return existing ? requireActive(existing) : emptySnapshot();
    });

    return this.read();
  }

  /** Return only records still owned by this active session. */
  async read(): Promise<PendingSnapshot> {
    this.ensureOpen();
    const snapshot = await get<PendingSnapshot>(this.key);
    this.ensureOpen();

    return requireActive(snapshot);
  }

  /** Commit the stable operation before transport and clear only the exact draft it captured. */
  async enqueue(options: EnqueueOptions): Promise<void> {
    await this.mutate((snapshot) => {
      const exists = snapshot.pending.some(
        (message) => message.request.message_id === options.message.request.message_id,
      );
      if (!exists && snapshot.pending.length >= MAX_PENDING_MESSAGES) {
        throw new Error('There are already 100 pending messages. Retry or discard one first.');
      }
      snapshot.pending = snapshot.pending.filter(
        (message) => message.request.message_id !== options.message.request.message_id,
      );
      snapshot.pending.push(options.message);
      if (options.draft && snapshot.drafts[options.draft.destination]?.id === options.draft.id) {
        delete snapshot.drafts[options.draft.destination];
      }
    });
  }

  /** Change an existing operation without reviving one removed by another task or tab. */
  async updatePending(message: PendingMessage): Promise<boolean> {
    let wasUpdated = false;
    await this.mutate((snapshot) => {
      const index = snapshot.pending.findIndex((current) => {
        return current.request.message_id === message.request.message_id;
      });
      if (index < 0) {
        return;
      }
      snapshot.pending[index] = message;
      wasUpdated = true;
    });

    return wasUpdated;
  }

  /** Remove reconciled or explicitly discarded work while retaining the ownership tombstone. */
  async remove(messageId: string): Promise<void> {
    await this.mutate((snapshot) => {
      snapshot.pending = snapshot.pending.filter(
        (message) => message.request.message_id !== messageId,
      );
    });
  }

  /** Retain an ambiguous desired-state operation across reloads and competing tabs. */
  async rememberCommand(
    request: components['schemas']['MessageCommand'],
  ): Promise<components['schemas']['MessageCommand']> {
    let remembered = request;
    await this.mutate((snapshot) => {
      snapshot.commands ??= [];
      const existing = snapshot.commands.find((entry) => {
        return (
          entry.request.conversation_id === request.conversation_id &&
          JSON.stringify(entry.request.action) === JSON.stringify(request.action)
        );
      });
      if (existing) {
        remembered = existing.request;
        return;
      }
      if (snapshot.commands.length >= MAX_PENDING_MESSAGES) {
        throw new Error('Resolve pending actions before creating another one.');
      }
      snapshot.commands.push({ request, createdAt: Date.now() });
    });
    return remembered;
  }

  /** Forget an acknowledged or explicitly abandoned action without implying server cancellation. */
  async removeCommand(operationId: string): Promise<void> {
    await this.mutate((snapshot) => {
      snapshot.commands = snapshot.commands?.filter(
        (entry) => entry.request.operation_id !== operationId,
      );
    });
  }

  /** Save a private draft without letting draft growth exceed the directory budget. */
  async saveDraft(options: {
    destination: string;
    draft: Draft;
    expectedId?: string;
  }): Promise<Draft | undefined> {
    let conflict: Draft | undefined;
    await this.mutate((snapshot) => {
      const isNew = !snapshot.drafts[options.destination];
      if (isNew && Object.keys(snapshot.drafts).length >= MAX_DRAFTS) {
        throw new Error('The draft limit has been reached. Clear an unused draft first.');
      }
      const existing = snapshot.drafts[options.destination];
      const hasConcurrentEdit =
        existing && existing.id !== options.expectedId && existing.id !== options.draft.id;
      if (hasConcurrentEdit) {
        const alternatives = snapshot.draftAlternatives?.[options.destination] ?? [];
        if (alternatives.length >= MAX_DRAFT_ALTERNATIVES) {
          throw new Error(
            'Resolve the recovered draft alternatives before saving another conflict.',
          );
        }
        snapshot.draftAlternatives ??= {};
        snapshot.draftAlternatives[options.destination] = [...alternatives, existing];
        conflict = existing;
      }
      const isEmpty =
        !options.draft.value.text && !options.draft.value.richText && !options.draft.reply;
      if (isEmpty && !options.draft.hasLocalChanges) {
        delete snapshot.drafts[options.destination];
        return;
      }
      snapshot.drafts[options.destination] = options.draft;
    });
    return conflict;
  }

  /** Acknowledge only a still-owned draft revision, preserving typing and alternatives from other tabs. */
  async acknowledgeDraft(options: { destination: string; draft: Draft }): Promise<void> {
    await this.mutate((snapshot) => {
      if (snapshot.drafts[options.destination]?.id === options.draft.id) {
        snapshot.drafts[options.destination] = options.draft;
      }
      const alternatives = snapshot.draftAlternatives?.[options.destination];
      if (alternatives) {
        snapshot.draftAlternatives![options.destination] = alternatives.map((draft) => {
          return draft.id === options.draft.id ? options.draft : draft;
        });
      }
    });
  }

  /** Remove an explicitly resolved alternative without discarding the active draft. */
  async resolveAlternative(options: { destination: string; id: string }): Promise<void> {
    await this.mutate((snapshot) => {
      const alternatives = snapshot.draftAlternatives?.[options.destination];
      if (alternatives) {
        snapshot.draftAlternatives![options.destination] = alternatives.filter(
          (draft) => draft.id !== options.id,
        );
      }
    });
  }

  /** Clear private records and permanently fence every existing writer for this session key. */
  async invalidate(): Promise<void> {
    this.isClosed = true;
    await update<PendingSnapshot>(this.key, () => ({
      isActive: false,
      pending: [],
      drafts: {},
    }));
  }

  private ensureOpen(): void {
    if (this.isClosed) {
      throw new DOMException('Pending ownership has ended.', 'AbortError');
    }
  }

  private async mutate(change: (snapshot: PendingSnapshot) => void): Promise<void> {
    this.ensureOpen();
    // idb-keyval runs this read/modify/write in one IndexedDB transaction across all tabs.
    await update<PendingSnapshot>(this.key, (existing) => {
      this.ensureOpen();
      const snapshot = requireActive(existing);
      change(snapshot);
      return snapshot;
    });
    this.ensureOpen();
  }
}
