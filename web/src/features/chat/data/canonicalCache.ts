import { get, update } from 'idb-keyval';
import type { components } from '@/api/schema';
import {
  compareCounter,
  mergeMessages,
  scrubReplySource,
  type Conversation,
} from './messageModels';

type HistoryPage = components['schemas']['HistoryPage'];
type SyncPage = components['schemas']['SyncPage'];
type Bootstrap = Pick<components['schemas']['Bootstrap'], 'cursor' | 'conversations'>;

const MAX_CACHED_PAGES = 3;
const MAX_REMOVAL_FENCES = 1000;
const MAX_HISTORY_CODE_UNITS = 1_000_000;

export interface CacheCheckpoint {
  epoch: string;
  cursor: string;
}

export interface CanonicalSnapshot extends CacheCheckpoint {
  isActive: boolean;
  conversations: Conversation[];
  pages: Record<string, HistoryPage>;
  invalidations: Record<string, string>;
  removedMessages: Record<string, string>;
  removedConversations: string[];
}

interface CursorIdentity {
  deployment_id: string;
  user_id: string;
  position: string;
}

function decodeCursor(encoded: string): CursorIdentity {
  const normalized = encoded.replaceAll('-', '+').replaceAll('_', '/');
  return JSON.parse(atob(normalized)) as CursorIdentity;
}

/** Compare scoped observation positions without rounding their decimal counters. */
export function observedAtLeast(candidate: string, minimum: string): boolean {
  const observed = decodeCursor(candidate);
  const required = decodeCursor(minimum);
  return (
    observed.deployment_id === required.deployment_id &&
    observed.user_id === required.user_id &&
    compareCounter(observed.position, required.position) >= 0
  );
}

function initialSnapshot(bootstrap: Bootstrap): CanonicalSnapshot {
  return {
    isActive: true,
    epoch: crypto.randomUUID(),
    cursor: bootstrap.cursor,
    conversations: bootstrap.conversations,
    pages: {},
    invalidations: {},
    removedMessages: {},
    removedConversations: [],
  };
}

function active(snapshot: CanonicalSnapshot | undefined): CanonicalSnapshot {
  if (!snapshot?.isActive) {
    throw new DOMException('Canonical cache ownership has ended.', 'AbortError');
  }
  return snapshot;
}

function matches(snapshot: CanonicalSnapshot, expected: CacheCheckpoint): boolean {
  return snapshot.epoch === expected.epoch && snapshot.cursor === expected.cursor;
}

function boundPages(snapshot: CanonicalSnapshot): void {
  const identifiers = Object.keys(snapshot.pages);
  let size = JSON.stringify(snapshot.pages).length;
  while (identifiers.length > MAX_CACHED_PAGES || size > MAX_HISTORY_CODE_UNITS) {
    const oldest = identifiers.shift();
    if (!oldest) {
      break;
    }
    delete snapshot.pages[oldest];
    size = JSON.stringify(snapshot.pages).length;
  }
}

function applyGroup(snapshot: CanonicalSnapshot, group: SyncPage['groups'][number]): void {
  const conversationId = group.conversation_id;
  const previous = snapshot.conversations.find(
    (conversation) => conversation.id === conversationId,
  );
  const incoming = group.conversation;
  if (!incoming) {
    snapshot.conversations = snapshot.conversations.filter(
      (conversation) => conversation.id !== conversationId,
    );
    delete snapshot.pages[conversationId];
    if (!snapshot.removedConversations.includes(conversationId)) {
      snapshot.removedConversations.push(conversationId);
    }
    return;
  }
  if (previous && compareCounter(previous.version, incoming.version) > 0) {
    return;
  }
  snapshot.conversations = snapshot.conversations.filter(
    (conversation) => conversation.id !== conversationId,
  );
  snapshot.conversations.push(incoming);
  if (previous && previous.generation !== incoming.generation) {
    delete snapshot.pages[conversationId];
  }
  snapshot.removedConversations = snapshot.removedConversations.filter(
    (id) => id !== conversationId,
  );
  const removedId =
    group.removed_message_id ?? (group.message?.is_deleted ? group.message.id : undefined);
  if (removedId) {
    snapshot.removedMessages[removedId] = conversationId;
  }
  const page = snapshot.pages[conversationId];
  if (!page) {
    return;
  }
  if (removedId) {
    page.messages = page.messages.filter((message) => message.id !== removedId);
    if (page.preceding_message?.id === removedId) {
      page.preceding_message = null;
    }
  }
  const message = group.message;
  if (message && !message.is_deleted) {
    const isPresent = page.messages.some((current) => current.id === message.id);
    if (isPresent) {
      page.messages = mergeMessages({
        current: page.messages,
        incoming: [message],
        edge: 'latest',
      });
    } else {
      page.has_newer = true;
    }
  }
  for (const current of page.messages) {
    if (removedId && current.reply?.message_id === removedId) {
      current.reply = {
        ...current.reply,
        is_unavailable: true,
        quote: null,
      };
    }
  }
  if (message) {
    page.messages = scrubReplySource(page.messages, message);
  }
}

export class CanonicalCache {
  private readonly key: string;
  private isClosed = false;
  private channel?: BroadcastChannel;

  /** Scope canonical state to the same deployment/account/session ownership as pending sends. */
  constructor({ key }: { key: string }) {
    this.key = `tg-chat:canonical:v1:${key}`;
  }

  /** Observe only invalidation hints; every tab rereads the authoritative IndexedDB transaction. */
  subscribe(listener: () => void): () => void {
    if (typeof BroadcastChannel === 'undefined') {
      return () => undefined;
    }
    this.channel = new BroadcastChannel(this.key);
    this.channel.onmessage = listener;
    return () => {
      this.channel?.close();
      this.channel = undefined;
    };
  }

  /** Recover the last atomic checkpoint, using bootstrap only when no cache exists. */
  async open(bootstrap: Bootstrap): Promise<CanonicalSnapshot> {
    this.ensureOpen();
    await update<CanonicalSnapshot>(this.key, (existing) => {
      this.ensureOpen();
      return existing ? active(existing) : initialSnapshot(bootstrap);
    });
    return this.read();
  }

  /** Read the shared committed snapshot after another tab wins a checkpoint race. */
  async read(): Promise<CanonicalSnapshot> {
    this.ensureOpen();
    const snapshot = await get<CanonicalSnapshot>(this.key);
    this.ensureOpen();
    return active(snapshot);
  }

  /** Commit all sync projections and their cursor in one compare-and-set transaction. */
  async applySync(options: { expected: CacheCheckpoint; page: SyncPage }): Promise<boolean> {
    return this.mutate(options.expected, (snapshot) => {
      if (!observedAtLeast(options.page.cursor, snapshot.cursor)) {
        return false;
      }
      for (const group of options.page.groups) {
        const previous = snapshot.conversations.find((item) => item.id === group.conversation_id);
        const hasAccessChange = previous && previous.generation !== group.conversation?.generation;
        const hasContentInvalidation =
          group.removed_message_id ||
          group.message?.is_deleted ||
          (group.message && compareCounter(group.message.version, '1') > 0);
        applyGroup(snapshot, group);
        if (!group.conversation || hasAccessChange || hasContentInvalidation) {
          snapshot.invalidations[group.conversation_id] = options.page.observation_cursor;
        }
      }
      snapshot.cursor = options.page.cursor;
      const fences =
        Object.keys(snapshot.removedMessages).length + snapshot.removedConversations.length;
      if (fences > MAX_REMOVAL_FENCES) {
        // Dropping tombstones also invalidates every old history/ack writer through a new epoch.
        snapshot.epoch = crypto.randomUUID();
        snapshot.pages = {};
        snapshot.invalidations = {};
        snapshot.removedMessages = {};
        snapshot.removedConversations = [];
      }
      boundPages(snapshot);
      return true;
    });
  }

  /** Persist a history snapshot only if no newer invalidation or access generation supersedes it. */
  async saveHistory(options: {
    expected: CacheCheckpoint;
    conversationId: string;
    page: HistoryPage;
  }): Promise<boolean> {
    return this.mutate(options.expected, (snapshot) => {
      const conversation = snapshot.conversations.find(
        (item) => item.id === options.conversationId,
      );
      if (!conversation || conversation.generation !== options.page.generation) {
        return false;
      }
      const invalidated = snapshot.invalidations[options.conversationId];
      if (invalidated && !observedAtLeast(options.page.observation_cursor, invalidated)) {
        return false;
      }
      // Delete/reinsert records recency without a second unbounded index.
      delete snapshot.pages[options.conversationId];
      snapshot.pages[options.conversationId] = options.page;
      boundPages(snapshot);
      return true;
    });
  }

  /** Replace server-derived projections and fence pre-reset requests without touching pending work. */
  async reset(options: { expected: CacheCheckpoint; bootstrap: Bootstrap }): Promise<boolean> {
    let didReset = false;
    await update<CanonicalSnapshot>(this.key, (existing) => {
      this.ensureOpen();
      const snapshot = active(existing);
      if (!matches(snapshot, options.expected)) {
        return snapshot;
      }
      didReset = true;
      return initialSnapshot(options.bootstrap);
    });
    if (didReset) {
      this.channel?.postMessage({ kind: 'changed' });
    }
    return didReset;
  }

  /** Keep an ownership tombstone so late writers cannot recreate a logged-out session's cache. */
  async invalidate(): Promise<void> {
    this.isClosed = true;
    await update<CanonicalSnapshot>(this.key, (existing) => ({
      isActive: false,
      epoch: existing?.epoch ?? crypto.randomUUID(),
      cursor: '',
      conversations: [],
      pages: {},
      invalidations: {},
      removedMessages: {},
      removedConversations: [],
    }));
  }

  private ensureOpen(): void {
    if (this.isClosed) {
      throw new DOMException('Canonical cache ownership has ended.', 'AbortError');
    }
  }

  private async mutate(
    expected: CacheCheckpoint,
    change: (snapshot: CanonicalSnapshot) => boolean,
  ): Promise<boolean> {
    let didCommit = false;
    await update<CanonicalSnapshot>(this.key, (existing) => {
      this.ensureOpen();
      const snapshot = active(existing);
      if (!matches(snapshot, expected)) {
        return snapshot;
      }
      didCommit = change(snapshot);
      return snapshot;
    });
    this.ensureOpen();
    if (didCommit) {
      this.channel?.postMessage({ kind: 'changed' });
    }
    return didCommit;
  }
}
