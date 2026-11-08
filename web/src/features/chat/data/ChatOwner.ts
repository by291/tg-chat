import type { EmojiText } from '@/domain/messages/customEmoji';
import { ApiError, isCancelled, requirePayload, SessionOwner } from '@/features/auth/SessionOwner';
import { canonicalMessageContent } from './messageContent';
import {
  compareCounter,
  destinationKey,
  MAX_VISIBLE_MESSAGES,
  mergeMessages,
  type CanonicalMessage,
  type Conversation,
  type Destination,
} from './messageModels';
import { PendingMessages, type Draft, type PendingMessage } from './pendingMessages';

const RETRY_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
const MAX_BACKOFF_MS = 30_000;

interface Selection {
  destination: Destination;
  title: string;
}

export interface ChatSnapshot {
  conversations: Conversation[];
  messages: CanonicalMessage[];
  precedingMessage?: CanonicalMessage;
  pending: PendingMessage[];
  selection?: Selection;
  draft: Draft;
  hasOlder: boolean;
  hasNewer: boolean;
  isLoading: boolean;
  isReady: boolean;
  error: string;
}

function emptyDraft(): Draft {
  return { id: crypto.randomUUID(), value: { text: '' } };
}

function initialSnapshot(): ChatSnapshot {
  return {
    conversations: [],
    messages: [],
    pending: [],
    draft: emptyDraft(),
    hasOlder: false,
    hasNewer: false,
    isLoading: false,
    isReady: false,
    error: '',
  };
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

export class ChatOwner {
  private readonly session: SessionOwner;
  private readonly revision: number;
  private readonly userId: string;
  private readonly sessionId: string;
  private store?: PendingMessages;
  private snapshot = initialSnapshot();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private cursor = '';
  private viewGeneration = 0;
  private isDisposed = false;
  private syncPromise?: Promise<void>;
  private sendPromise?: Promise<void>;

  /** Own connected projections and pending work within one authenticated session generation. */
  constructor(options: { session: SessionOwner; store?: PendingMessages }) {
    this.session = options.session;
    this.store = options.store;
    const session = this.session.getSnapshot();
    if (!session.auth) {
      throw new Error('An authenticated session is required.');
    }
    this.revision = session.revision;
    this.userId = session.auth.user.id;
    this.sessionId = session.auth.session.id;
    this.unsubscribe = this.session.subscribe(() => {
      if (this.session.getSnapshot().revision !== this.revision) {
        this.invalidate();
      }
    });
  }

  /** Return a stable immutable snapshot for React's external-store subscription. */
  getSnapshot = (): ChatSnapshot => this.snapshot;

  /** Observe private projections without coupling renderers to transport or persistence. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Load a bounded directory and restore pending identities before enabling the composer. */
  async start(): Promise<void> {
    this.ensureCurrent();
    const reply = await this.session.client.GET('/api/v1/chat/bootstrap');
    this.ensureCurrent();
    const bootstrap = requirePayload(reply);
    this.store ??= new PendingMessages({
      key: `${bootstrap.deployment_id}:${this.userId}:${this.sessionId}`,
    });
    const persisted = await this.store.open();
    this.ensureCurrent();
    this.cursor = bootstrap.cursor;
    this.publish({
      conversations: bootstrap.conversations,
      pending: persisted.pending.map((message) => ({
        ...message,
        status: message.status === 'sending' ? 'queued' : message.status,
      })),
      isReady: true,
      error: '',
    });
  }

  /** Poll serially while visible and catch up immediately after focus or network recovery. */
  connect(): () => void {
    let isStopped = false;
    let isRunning = false;
    let timer: ReturnType<typeof setTimeout>;
    let backoff = POLL_INTERVAL_MS;
    const tick = async () => {
      if (isStopped || isRunning || this.isDisposed) {
        return;
      }
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }
      isRunning = true;
      try {
        await this.catchUp();
        await this.flush();
        backoff = POLL_INTERVAL_MS;
      } catch (error) {
        this.report(error);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
      isRunning = false;
      if (!isStopped) {
        timer = setTimeout(tick, backoff);
      }
    };
    const wake = () => {
      clearTimeout(timer);
      void tick();
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);

    return () => {
      isStopped = true;
      clearTimeout(timer);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }

  /** Switch private history ownership before starting any remote page request. */
  async select(selection: Selection): Promise<void> {
    this.ensureCurrent();
    const generation = ++this.viewGeneration;
    this.publish({
      selection,
      isLoading: false,
      messages: [],
      precedingMessage: undefined,
      draft: emptyDraft(),
      hasOlder: false,
      hasNewer: false,
      error: '',
    });
    const initialDraftId = this.snapshot.draft.id;
    const persisted = await this.requireStore().read();
    if (!this.isCurrentView(generation)) {
      return;
    }
    const draft = persisted.drafts[destinationKey(selection.destination)] ?? emptyDraft();
    if (this.snapshot.draft.id === initialDraftId) {
      this.publish({ draft });
    }
    await this.loadHistory('latest');
  }

  /** Retain new edits immediately while IndexedDB serializes their durable draft revisions. */
  async setDraft(value: EmojiText): Promise<void> {
    this.ensureCurrent();
    const selection = this.snapshot.selection;
    if (!selection) {
      return;
    }
    const draft = { id: crypto.randomUUID(), value };
    this.publish({ draft });
    await this.requireStore().saveDraft({
      destination: destinationKey(selection.destination),
      draft,
    });
  }

  /** Persist before transport and preserve edits made while that write is pending. */
  async queueSend(value: EmojiText): Promise<void> {
    this.ensureCurrent();
    const selection = this.snapshot.selection;
    if (!selection) {
      return;
    }
    const draftId = this.snapshot.draft.id;
    const generation = this.viewGeneration;
    const pending: PendingMessage = {
      createdAt: Date.now(),
      title: selection.title,
      status: 'queued',
      request: {
        operation_id: crypto.randomUUID(),
        message_id: crypto.randomUUID(),
        destination: selection.destination,
        content: canonicalMessageContent(value),
      },
    };
    await this.requireStore().enqueue({
      message: pending,
      draft: { destination: destinationKey(selection.destination), id: draftId },
    });
    this.ensureCurrent();
    const canClearDraft = this.isCurrentView(generation) && this.snapshot.draft.id === draftId;
    this.publish({
      pending: [...this.snapshot.pending, pending],
      draft: canClearDraft ? emptyDraft() : this.snapshot.draft,
      error: '',
    });
    void this.flush().catch((error) => this.report(error));
  }

  /** Retry queued operations serially; an ambiguous response always reuses the original request. */
  flush(): Promise<void> {
    this.sendPromise ??= this.sendQueued().finally(() => {
      this.sendPromise = undefined;
    });
    return this.sendPromise;
  }

  /** Retry a visible failed operation after an explicit user decision. */
  async retry(messageId: string): Promise<void> {
    const pending = this.snapshot.pending.find(
      (message) => message.request.message_id === messageId,
    );
    if (!pending) {
      return;
    }
    const queued: PendingMessage = { ...pending, status: 'queued', error: undefined };
    await this.requireStore().enqueue({ message: queued });
    this.replacePending(queued);
    await this.flush();
  }

  /** Remove a pending item without claiming that an ambiguous server send was cancelled. */
  async discard(messageId: string): Promise<void> {
    await this.requireStore().remove(messageId);
    this.ensureCurrent();
    this.publish({
      pending: this.snapshot.pending.filter((message) => message.request.message_id !== messageId),
    });
  }

  /** Coalesce concurrent wakeups into one ordered cursor consumer. */
  catchUp(): Promise<void> {
    this.syncPromise ??= this.readChanges()
      .catch(async (error: unknown) => {
        if (!(error instanceof ApiError) || error.code !== 'sync_reset_required') {
          throw error;
        }
        await this.start();
        await this.loadHistory('latest');
      })
      .finally(() => {
        this.syncPromise = undefined;
      });
    return this.syncPromise;
  }

  /** Load a bounded older or latest page while fencing results from previously selected chats. */
  async loadHistory(edge: 'older' | 'latest'): Promise<void> {
    this.ensureCurrent();
    const conversation = this.selectedConversation();
    if (!conversation || this.snapshot.isLoading) {
      return;
    }
    const generation = this.viewGeneration;
    const first = this.snapshot.messages[0];
    this.publish({ isLoading: true });
    try {
      const reply = await this.session.client.GET(
        '/api/v1/conversations/{conversation_id}/history',
        {
          params: {
            path: { conversation_id: conversation.id },
            query: { before: edge === 'older' ? first?.sequence : undefined },
          },
        },
      );
      if (!this.isCurrentView(generation)) {
        return;
      }
      const page = requirePayload(reply);
      // A send or sync may have committed after the history snapshot began. Keep those newer rows.
      const firstSequence = page.messages[0]?.sequence;
      const current = this.snapshot.messages.filter((message) => {
        return (
          edge === 'older' || !firstSequence || compareCounter(message.sequence, firstSequence) >= 0
        );
      });
      const messages = mergeMessages({ current, incoming: page.messages, edge });
      const combinedIds = new Set([...current, ...page.messages].map((message) => message.id));
      const hasTrimmedNewer = edge === 'older' && combinedIds.size > MAX_VISIBLE_MESSAGES;
      this.publish({
        messages,
        precedingMessage: page.preceding_message ?? undefined,
        hasOlder: page.has_older,
        hasNewer: page.has_newer || hasTrimmedNewer,
        error: '',
      });
    } catch (error) {
      if (this.isCurrentView(generation)) {
        this.report(error);
      }
    } finally {
      if (this.isCurrentView(generation)) {
        this.publish({ isLoading: false });
      }
    }
  }

  /** Resolve a recipient or Saved draft to its canonical directory entry once it exists. */
  selectedConversation(): Conversation | undefined {
    const destination = this.snapshot.selection?.destination;
    if (!destination) {
      return undefined;
    }
    return this.snapshot.conversations.find((conversation) => {
      if (destination.kind === 'saved') {
        return conversation.kind === 'saved';
      }
      if (destination.kind === 'conversation') {
        return conversation.id === destination.conversation_id;
      }
      return conversation.kind === 'direct' && conversation.peer_id === destination.user_id;
    });
  }

  /** Stop view work on unmount while leaving durable operations recoverable after reload. */
  dispose(): void {
    this.isDisposed = true;
    this.unsubscribe();
    this.listeners.clear();
  }

  private async readChanges(): Promise<void> {
    this.ensureCurrent();
    let hasMore = true;
    while (hasMore) {
      const reply = await this.session.client.GET('/api/v1/chat/sync', {
        params: { query: { cursor: this.cursor } },
      });
      this.ensureCurrent();
      const page = requirePayload(reply);
      for (const group of page.groups) {
        this.mergeConversation(group.conversation);
        if (group.message) {
          await this.acceptMessage(group.message);
        }
      }
      this.cursor = page.cursor;
      hasMore = page.has_more;
    }
    this.publish({ error: '' });
  }

  private async sendQueued(): Promise<void> {
    for (const pending of this.snapshot.pending) {
      if (this.isDisposed || pending.status === 'failed') {
        continue;
      }
      if (Date.now() - pending.createdAt > RETRY_LIFETIME_MS) {
        await this.failPending(
          pending,
          'Automatic retry expired. Check history before discarding.',
        );
        continue;
      }
      this.replacePending({ ...pending, status: 'sending', error: undefined });
      try {
        const reply = await this.session.client.POST('/api/v1/messages', { body: pending.request });
        this.ensureCurrent();
        const receipt = requirePayload(reply);
        this.mergeConversation(receipt.conversation);
        await this.acceptMessage(receipt.message);
      } catch (error) {
        if (isCancelled(error) || this.isDisposed) {
          return;
        }
        const isPermanent =
          error instanceof ApiError &&
          !['dependency_unavailable', 'rate_limited', 'network_unavailable'].includes(error.code);
        if (isPermanent) {
          await this.failPending(pending, failureMessage(error));
        } else {
          this.replacePending({ ...pending, status: 'queued', error: 'Waiting to retry safely.' });
        }
      }
    }
  }

  private async acceptMessage(message: CanonicalMessage): Promise<void> {
    const isPending = this.snapshot.pending.some(
      (pending) => pending.request.message_id === message.id,
    );
    if (isPending) {
      await this.requireStore().remove(message.id);
      this.ensureCurrent();
    }
    const pending = this.snapshot.pending.filter(
      (candidate) => candidate.request.message_id !== message.id,
    );
    const isSelected = this.selectedConversation()?.id === message.conversation_id;
    const isVisible = this.snapshot.messages.some((candidate) => candidate.id === message.id);
    const canAppend = isSelected && (!this.snapshot.hasNewer || isVisible);
    const messages = canAppend
      ? mergeMessages({ current: this.snapshot.messages, incoming: [message], edge: 'latest' })
      : this.snapshot.messages;
    this.publish({
      pending,
      messages,
      hasNewer: this.snapshot.hasNewer || (isSelected && !canAppend),
      hasOlder: this.snapshot.hasOlder || messages.length >= MAX_VISIBLE_MESSAGES,
    });
  }

  private mergeConversation(incoming: Conversation): void {
    const current = this.snapshot.conversations.find(
      (conversation) => conversation.id === incoming.id,
    );
    if (current && compareCounter(current.version, incoming.version) > 0) {
      return;
    }
    const conversations = this.snapshot.conversations.filter(
      (conversation) => conversation.id !== incoming.id,
    );
    conversations.push(incoming);
    conversations.sort((first, second) => second.updated_at.localeCompare(first.updated_at));
    this.publish({ conversations });
  }

  private async failPending(pending: PendingMessage, error: string): Promise<void> {
    const failed: PendingMessage = { ...pending, status: 'failed', error };
    await this.requireStore().enqueue({ message: failed });
    this.replacePending(failed);
  }

  private replacePending(pending: PendingMessage): void {
    this.publish({
      pending: this.snapshot.pending.map((current) => {
        return current.request.message_id === pending.request.message_id ? pending : current;
      }),
    });
  }

  private requireStore(): PendingMessages {
    this.ensureCurrent();
    if (!this.store) {
      throw new Error('Chat storage is not ready.');
    }
    return this.store;
  }

  private isCurrentView(generation: number): boolean {
    return !this.isDisposed && this.viewGeneration === generation;
  }

  private ensureCurrent(): void {
    if (this.isDisposed || this.session.getSnapshot().revision !== this.revision) {
      throw new DOMException('Chat ownership has ended.', 'AbortError');
    }
  }

  private invalidate(): void {
    this.isDisposed = true;
    this.snapshot = initialSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
    // Retain a tombstone rather than deleting the key: another tab may still hold an old writer.
    void this.store?.invalidate().catch(() => undefined);
  }

  private report(error: unknown): void {
    if (!this.isDisposed && !isCancelled(error)) {
      this.publish({ error: failureMessage(error) });
    }
  }

  private publish(change: Partial<ChatSnapshot>): void {
    if (this.isDisposed) {
      return;
    }
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
