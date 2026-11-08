import { get, update } from 'idb-keyval';
import type { components } from '@/api/schema';
import type { EmojiText } from '@/domain/messages/customEmoji';

const MAX_PENDING_MESSAGES = 100;
const MAX_DRAFTS = 201;

export interface PendingMessage {
  request: components['schemas']['SendMessage'];
  createdAt: number;
  status: 'queued' | 'sending' | 'failed';
  error?: string;
}

export interface Draft {
  id: string;
  value: EmojiText;
}

export interface PendingSnapshot {
  isActive: boolean;
  pending: PendingMessage[];
  drafts: Record<string, Draft>;
}

interface EnqueueOptions {
  message: PendingMessage;
  draft?: { destination: string; id: string };
}

function emptySnapshot(): PendingSnapshot {
  return { isActive: true, pending: [], drafts: {} };
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

  /** Remove reconciled or explicitly discarded work while retaining the ownership tombstone. */
  async remove(messageId: string): Promise<void> {
    await this.mutate((snapshot) => {
      snapshot.pending = snapshot.pending.filter(
        (message) => message.request.message_id !== messageId,
      );
    });
  }

  /** Save a private draft without letting draft growth exceed the directory budget. */
  async saveDraft(options: { destination: string; draft: Draft }): Promise<void> {
    await this.mutate((snapshot) => {
      const isNew = !snapshot.drafts[options.destination];
      if (isNew && Object.keys(snapshot.drafts).length >= MAX_DRAFTS) {
        throw new Error('The draft limit has been reached. Clear an unused draft first.');
      }
      if (!options.draft.value.text && !options.draft.value.richText) {
        delete snapshot.drafts[options.destination];
        return;
      }
      snapshot.drafts[options.destination] = options.draft;
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
