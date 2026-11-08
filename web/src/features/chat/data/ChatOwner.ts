import { Centrifuge } from 'centrifuge';
import type { components } from '@/api/schema';
import { restoreServerDraft } from './draftModels';
import { CanonicalCache, observedAtLeast, type CanonicalSnapshot } from './canonicalCache';
import type { EmojiText } from '@/domain/messages/customEmoji';
import { ApiError, isCancelled, requirePayload, SessionOwner } from '@/features/auth/SessionOwner';
import { canonicalMessageContent } from './messageContent';
import {
  compareCounter,
  destinationKey,
  MAX_VISIBLE_MESSAGES,
  mergeMessages,
  scrubReplySource,
  type CanonicalMessage,
  type Conversation,
  type Destination,
} from './messageModels';
import {
  PendingMessages,
  type Draft,
  type PendingMessage,
  type PendingCommand,
} from './pendingMessages';

const RETRY_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
const MAX_BACKOFF_MS = 30_000;
const DRAFT_DEBOUNCE_MS = 500;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
// prettier-ignore
const TRANSIENT_ERROR_CODES = new Set([
  'dependency_unavailable',
  'rate_limited',
  'network_unavailable',
]);

interface HistoryLoad {
  generation: number;
  edge: 'older' | 'latest';
  concurrentMessages: CanonicalMessage[];
}

interface Selection {
  destination: Destination;
  title: string;
}

export interface ChatSnapshot {
  conversations: Conversation[];
  messages: CanonicalMessage[];
  precedingMessage?: CanonicalMessage;
  pending: PendingMessage[];
  pendingCommands: PendingCommand[];
  selection?: Selection;
  draft: Draft;
  draftConflict?: Draft;
  draftAlternatives?: Draft[];
  editConflict?: CanonicalMessage;
  navigation?: { messageId: string; requestId: number };
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
    pendingCommands: [],
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

function precedingMessage(options: {
  messages: CanonicalMessage[];
  candidates: Array<CanonicalMessage | undefined>;
}): CanonicalMessage | undefined {
  const first = options.messages[0];
  if (!first) {
    return undefined;
  }
  let preceding: CanonicalMessage | undefined;
  for (const candidate of options.candidates) {
    if (!candidate || compareCounter(candidate.sequence, first.sequence) >= 0) {
      continue;
    }
    if (!preceding || compareCounter(candidate.sequence, preceding.sequence) > 0) {
      preceding = candidate;
    }
  }
  return preceding;
}

export class ChatOwner {
  private readonly session: SessionOwner;
  private readonly revision: number;
  private readonly userId: string;
  private readonly sessionId: string;
  private store?: PendingMessages;
  private cache?: CanonicalCache;
  private cacheSnapshot?: CanonicalSnapshot;
  private snapshot = initialSnapshot();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private cursor = '';
  private viewGeneration = 0;
  private historyLoad?: HistoryLoad;
  private isDisposed = false;
  private syncPromise?: Promise<void>;
  private sendPromise?: Promise<void>;
  private draftPromise?: Promise<void>;
  private draftTimer?: ReturnType<typeof setTimeout>;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private readonly explicitRetries = new Set<string>();

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
    this.cache ??= new CanonicalCache({
      key: `${bootstrap.deployment_id}:${this.userId}:${this.sessionId}`,
    });
    const cached = await this.cache.open(bootstrap);
    this.ensureCurrent();
    this.cacheSnapshot = cached;
    this.cursor = cached.cursor;
    this.publish({
      conversations: cached.conversations,
      pendingCommands: persisted.commands ?? [],
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
    let unwatchCache: (() => void) | undefined;
    const watchCache = () => {
      unwatchCache ??= this.cache?.subscribe(() => {
        void this.reloadSharedCache()
          .then(wake)
          .catch((error) => this.report(error));
      });
    };
    const tick = async () => {
      if (isStopped || isRunning || this.isDisposed) {
        return;
      }
      if (!this.snapshot.isReady || document.visibilityState === 'hidden') {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }
      isRunning = true;
      watchCache();
      try {
        await this.catchUp();
        await this.flush();
        await this.flushDraft();
        backoff = POLL_INTERVAL_MS;
      } catch (error) {
        this.report(error);
        const jitter = Math.floor(Math.random() * POLL_INTERVAL_MS);
        backoff = Math.min(backoff * 2 + jitter, MAX_BACKOFF_MS);
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
    const endpoint = new URL('/connection/websocket', window.location.href);
    endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
    const realtime = new Centrifuge(endpoint.toString());
    realtime.on('connected', wake);
    realtime.on('publication', wake);
    realtime.connect();
    watchCache();
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);

    return () => {
      isStopped = true;
      realtime.disconnect();
      unwatchCache?.();
      clearTimeout(timer);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }

  /** Switch private history ownership before starting any remote page request. */
  async select(selection: Selection): Promise<void> {
    this.ensureCurrent();
    void this.flushDraft().catch((error) => this.report(error));
    const generation = ++this.viewGeneration;
    this.historyLoad = undefined;
    this.publish({
      selection,
      isLoading: false,
      messages: [],
      precedingMessage: undefined,
      draft: emptyDraft(),
      draftConflict: undefined,
      draftAlternatives: [],
      editConflict: undefined,
      hasOlder: false,
      hasNewer: false,
      error: '',
    });
    const initialDraftId = this.snapshot.draft.id;
    const persisted = await this.requireStore().read();
    if (!this.isCurrentView(generation)) {
      return;
    }
    const key = destinationKey(selection.destination);
    const canonicalDraft = this.selectedConversation()?.draft;
    const remote = canonicalDraft ? restoreServerDraft(canonicalDraft) : emptyDraft();
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
    if (this.snapshot.draft.id === initialDraftId) {
      this.publish({
        draft,
        draftConflict: hasConflict ? remote : undefined,
        draftAlternatives: persisted.draftAlternatives?.[key] ?? [],
      });
    }
    const conversation = this.selectedConversation();
    const cached = await this.requireCache().read();
    const page = conversation ? cached.pages[conversation.id] : undefined;
    if (this.isCurrentView(generation) && page) {
      this.publish({
        messages: page.messages,
        precedingMessage: page.preceding_message ?? undefined,
        hasOlder: page.has_older,
        hasNewer: page.has_newer,
      });
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
    const previous = this.snapshot.draft;
    const draft: Draft = {
      id: crypto.randomUUID(),
      value,
      reply: previous.reply,
      serverVersion: previous.serverVersion ?? this.selectedConversation()?.draft.version ?? '0',
      hasLocalChanges: true,
    };
    this.publish({ draft });
    const conflict = await this.requireStore().saveDraft({
      destination: destinationKey(selection.destination),
      draft,
      expectedId: previous.id,
    });
    this.ensureCurrent();
    if (conflict) {
      this.publish({ draftAlternatives: [...(this.snapshot.draftAlternatives ?? []), conflict] });
    }
    this.scheduleDraft();
  }

  /** Synchronize one captured draft while preserving later typing and explicit remote conflicts. */
  flushDraft(): Promise<void> {
    clearTimeout(this.draftTimer);
    this.draftPromise ??= this.saveRemoteDraft().finally(() => {
      this.draftPromise = undefined;
    });
    return this.draftPromise;
  }

  /** Choose the remote version explicitly; active local text is never silently replaced. */
  async restoreDraft(draft: Draft): Promise<void> {
    const selection = this.snapshot.selection;
    if (!selection) {
      return;
    }
    const previous = this.snapshot.draft;
    const restored = { ...draft, id: crypto.randomUUID() };
    await this.requireStore().saveDraft({
      destination: destinationKey(selection.destination),
      draft: restored,
      expectedId: previous.id,
    });
    await this.requireStore().resolveAlternative({
      destination: destinationKey(selection.destination),
      id: draft.id,
    });
    const persisted = await this.requireStore().read();
    this.publish({
      draft: restored,
      draftConflict: undefined,
      draftAlternatives: persisted.draftAlternatives?.[destinationKey(selection.destination)] ?? [],
    });
  }

  /** Rebase local text only after the user explicitly chooses it over the competing server version. */
  async keepLocalDraft(): Promise<void> {
    const conflict = this.snapshot.draftConflict;
    if (!conflict) {
      return;
    }
    const draft = { ...this.snapshot.draft, serverVersion: conflict.serverVersion };
    this.publish({ draft, draftConflict: undefined });
    await this.setDraft(draft.value);
    await this.flushDraft();
  }

  /** Add or clear reply context without changing unrelated text in the composer. */
  async setReply(reply?: components['schemas']['ReplyInput']): Promise<void> {
    this.publish({ draft: { ...this.snapshot.draft, reply } });
    await this.setDraft(this.snapshot.draft.value);
  }

  /** Persist before transport and preserve edits made while that write is pending. */
  async queueSend(value: EmojiText): Promise<void> {
    this.ensureCurrent();
    const selection = this.snapshot.selection;
    if (!selection) {
      return;
    }
    const capturedDraft = this.snapshot.draft;
    const draftId = capturedDraft.id;
    const generation = this.viewGeneration;
    await this.flushDraft();
    this.ensureCurrent();
    const serverDraft = this.findConversation(selection.destination)?.draft;
    const content = canonicalMessageContent(value);
    const isMatchingDraft =
      serverDraft?.content?.text === content.text &&
      (serverDraft.content.rich_text ?? null) === (content.rich_text ?? null) &&
      JSON.stringify(serverDraft.content.custom_emoji) === JSON.stringify(content.custom_emoji) &&
      serverDraft?.reply?.message_id === capturedDraft.reply?.message_id &&
      (serverDraft?.reply?.quote ?? null) === (capturedDraft.reply?.quote ?? null);
    const pending: PendingMessage = {
      createdAt: Date.now(),
      title: selection.title,
      status: 'queued',
      request: {
        operation_id: crypto.randomUUID(),
        message_id: crypto.randomUUID(),
        destination: selection.destination,
        content,
        reply: capturedDraft.reply,
        draft_version: isMatchingDraft ? serverDraft?.version : undefined,
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
    await this.sendPromise;
    const pending = this.snapshot.pending.find(
      (message) => message.request.message_id === messageId,
    );
    if (!pending) {
      return;
    }
    const queued: PendingMessage = {
      ...pending,
      status: 'queued',
      error: undefined,
    };
    const wasUpdated = await this.requireStore().updatePending(queued);
    if (!wasUpdated) {
      return;
    }
    this.explicitRetries.add(messageId);
    this.replacePending(queued);
    await this.flush();
  }

  /** Remove a pending item without claiming that an ambiguous server send was cancelled. */
  async discard(messageId: string): Promise<void> {
    this.explicitRetries.delete(messageId);
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
        await this.resetCache();
        await this.loadHistory('latest');
      })
      .finally(() => {
        this.syncPromise = undefined;
      });
    return this.syncPromise;
  }

  /** Apply a desired-state action, retaining its identity if transport confirmation is ambiguous. */
  async command(action: components['schemas']['CommandAction']): Promise<void> {
    const conversation = this.selectedConversation();
    if (!conversation) {
      throw new Error('Choose an existing conversation first.');
    }
    const request = await this.requireStore().rememberCommand({
      operation_id: crypto.randomUUID(),
      conversation_id: conversation.id,
      action,
    });
    await this.retryCommand(request.operation_id);
  }

  /** Retry the exact persisted action, refusing an automatic reapplication beyond receipt retention. */
  async retryCommand(operationId: string): Promise<void> {
    const persisted = await this.requireStore().read();
    this.publish({ pendingCommands: persisted.commands ?? [] });
    const entry = persisted.commands?.find(
      (command) => command.request.operation_id === operationId,
    );
    if (!entry) {
      return;
    }
    if (Date.now() - entry.createdAt >= RETRY_LIFETIME_MS) {
      throw new Error(
        'This action is too old to retry safely. Review current state and remove it.',
      );
    }
    const request = entry.request;
    const action = request.action;
    const conversationId = request.conversation_id;
    const epoch = this.cacheSnapshot?.epoch;
    let result: Awaited<ReturnType<ChatOwner['postCommand']>>;
    try {
      result = await this.postCommand(request);
    } catch (error) {
      if (error instanceof ApiError && !TRANSIENT_ERROR_CODES.has(error.code)) {
        await this.discardCommand(operationId);
      }
      throw error;
    }
    this.ensureCurrent();
    await this.discardCommand(operationId);
    const cached = await this.requireCache().read();
    const invalidated = cached.invalidations[conversationId];
    const isCurrent =
      epoch === cached.epoch &&
      (!invalidated || observedAtLeast(result.receipt.observation_cursor, invalidated));
    if (isCurrent && result.receipt.conversation) {
      this.mergeConversation(result.receipt.conversation);
    } else if (isCurrent) {
      this.removeConversation(conversationId);
    }
    if (isCurrent && result.receipt.message) {
      await this.acceptMessage(result.receipt.message);
    }
    if (result.isConflict) {
      if (action.kind === 'edit') {
        this.publish({ editConflict: result.receipt.message ?? undefined });
      }
      throw new ApiError({
        code: 'message_conflict',
        message: 'This changed on another device. Review the current version before retrying.',
      });
    }
    this.publish({ editConflict: undefined });
    void this.catchUp().catch((error) => this.report(error));
  }

  /** Dismiss an uncertain action after the user has reviewed the authoritative state. */
  async discardCommand(operationId: string): Promise<void> {
    await this.requireStore().removeCommand(operationId);
    const persisted = await this.requireStore().read();
    this.publish({ pendingCommands: persisted.commands ?? [] });
  }

  private async postCommand(request: components['schemas']['MessageCommand']): Promise<{
    receipt: components['schemas']['CommandReceipt'];
    isConflict: boolean;
  }> {
    try {
      const reply = await this.session.client.POST('/api/v1/chat/commands', { body: request });
      return { receipt: requirePayload(reply), isConflict: false };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'message_conflict' && error.context) {
        // This representation crosses the same authenticated response boundary as successful JSON.
        return {
          receipt: error.context as components['schemas']['CommandReceipt'],
          isConflict: true,
        };
      }
      throw error;
    }
  }

  /** Read a bounded pin directory without replacing the contiguous timeline cache. */
  async loadPins(before?: string): Promise<components['schemas']['HistoryPage']> {
    const conversation = this.selectedConversation();
    if (!conversation) {
      throw new Error('Choose a conversation first.');
    }
    const generation = this.viewGeneration;
    const epoch = this.cacheSnapshot?.epoch;
    const reply = await this.session.client.GET('/api/v1/conversations/{conversation_id}/history', {
      params: {
        path: { conversation_id: conversation.id },
        query: { pinned: true, before },
      },
    });
    const page = requirePayload(reply);
    const cached = await this.requireCache().read();
    const invalidated = cached.invalidations[conversation.id];
    const isCurrent =
      this.isCurrentView(generation) &&
      epoch === cached.epoch &&
      (!invalidated || observedAtLeast(page.observation_cursor, invalidated));
    if (!isCurrent) {
      throw new DOMException('The pin directory changed while loading.', 'AbortError');
    }
    return page;
  }

  /** Advance only through an actual mounted message reached in a focused foreground document. */
  async markReached(messageId: string): Promise<void> {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) {
      return;
    }
    const conversation = this.selectedConversation();
    const reached = this.snapshot.messages.find((message) => message.id === messageId);
    if (
      !conversation ||
      !reached ||
      compareCounter(reached.sequence, conversation.read_through) <= 0
    ) {
      return;
    }
    await this.command({ kind: 'read', through: reached.sequence });
  }

  /** Reveal a reply target in a bounded authorized neighborhood, including targets outside memory. */
  async jumpToMessage(messageId: string): Promise<void> {
    const existing = this.snapshot.messages.find((message) => message.id === messageId);
    if (existing) {
      this.publish({ navigation: { messageId, requestId: Date.now() } });
      return;
    }
    await this.loadHistory('latest', messageId);
  }

  /** Load a bounded older or latest page while fencing results from previously selected chats. */
  async loadHistory(edge: 'older' | 'latest', around?: string): Promise<void> {
    this.ensureCurrent();
    const conversation = this.selectedConversation();
    if (!conversation || this.snapshot.isLoading) {
      return;
    }
    const generation = this.viewGeneration;
    const epoch = this.cacheSnapshot?.epoch;
    const first = this.snapshot.messages[0];
    const load: HistoryLoad = {
      generation,
      edge,
      concurrentMessages: [],
    };
    this.historyLoad = load;
    this.publish({ isLoading: true });
    try {
      const reply = await this.session.client.GET(
        '/api/v1/conversations/{conversation_id}/history',
        {
          params: {
            path: { conversation_id: conversation.id },
            query: { before: edge === 'older' ? first?.sequence : undefined, around },
          },
        },
      );
      if (!this.isCurrentView(generation)) {
        return;
      }
      const page = requirePayload(reply);
      const cached = await this.requireCache().read();
      if (!this.isCurrentView(generation) || epoch !== cached.epoch) {
        return;
      }
      const didSave = await this.requireCache().saveHistory({
        expected: cached,
        conversationId: conversation.id,
        page,
      });
      this.ensureCurrent();
      if (!didSave) {
        await this.reloadSharedCache();
        this.publish({ hasNewer: true });
        return;
      }
      // A send or sync may have committed after the history snapshot began. Keep those newer rows.
      const firstSequence = page.messages[0]?.sequence;
      const candidates = [...this.snapshot.messages, ...load.concurrentMessages];
      const current = candidates.filter((message) => {
        if (around) {
          return false;
        }
        return (
          edge === 'older' || !firstSequence || compareCounter(message.sequence, firstSequence) >= 0
        );
      });
      const messages = mergeMessages({
        current,
        incoming: page.messages,
        edge,
      });
      const combinedIds = new Set([...current, ...page.messages].map((message) => message.id));
      const hasTrimmedNewer = edge === 'older' && combinedIds.size > MAX_VISIBLE_MESSAGES;
      this.publish({
        messages,
        precedingMessage: precedingMessage({
          messages,
          // prettier-ignore
          candidates: [
            page.preceding_message ?? undefined,
            ...candidates,
            ...page.messages,
          ],
        }),
        navigation: around
          ? { messageId: around, requestId: Date.now() }
          : this.snapshot.navigation,
        hasOlder: page.has_older,
        hasNewer: page.has_newer || hasTrimmedNewer || (edge === 'older' && this.snapshot.hasNewer),
        error: '',
      });
    } catch (error) {
      if (this.isCurrentView(generation)) {
        this.report(error);
      }
    } finally {
      if (this.isCurrentView(generation)) {
        this.historyLoad = undefined;
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
    return this.findConversation(destination);
  }

  private findConversation(destination: Destination): Conversation | undefined {
    return this.snapshot.conversations.find((conversation) => {
      switch (destination.kind) {
        case 'saved':
          return conversation.kind === 'saved';
        case 'conversation':
          return conversation.id === destination.conversation_id;
        case 'recipient':
          return conversation.kind === 'direct' && conversation.peer_id === destination.user_id;
      }
    });
  }

  /** Stop view work on unmount while leaving durable operations recoverable after reload. */
  dispose(): void {
    clearTimeout(this.expiryTimer);
    clearTimeout(this.draftTimer);
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
      const expected = this.cacheSnapshot;
      if (!expected) {
        throw new Error('Chat cache is not ready.');
      }
      const didCommit = await this.requireCache().applySync({ expected, page });
      this.ensureCurrent();
      if (!didCommit) {
        await this.reloadSharedCache();
        continue;
      }
      const committed = await this.requireCache().read();
      this.ensureCurrent();
      if (committed.cursor !== page.cursor || committed.epoch !== expected.epoch) {
        await this.reloadSharedCache();
        continue;
      }
      this.cacheSnapshot = committed;
      for (const group of page.groups) {
        if (group.conversation) {
          this.mergeConversation(group.conversation);
        } else {
          this.removeConversation(group.conversation_id);
        }
        if (group.removed_message_id) {
          this.removeMessage(group.removed_message_id);
        }
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
      // Manual recovery grants one attempt without extending the operation's automatic retry age.
      const isExplicitRetry = this.explicitRetries.delete(pending.request.message_id);
      const isExpired = Date.now() - pending.createdAt > RETRY_LIFETIME_MS;
      if (isExpired && !isExplicitRetry) {
        await this.failPending(
          pending,
          'Automatic retry expired. Check history before discarding.',
        );
        continue;
      }
      this.replacePending({
        ...pending,
        status: 'sending',
        error: undefined,
      });
      try {
        const epoch = this.cacheSnapshot?.epoch;
        const reply = await this.session.client.POST('/api/v1/messages', { body: pending.request });
        this.ensureCurrent();
        const receipt = requirePayload(reply);
        const cached = await this.requireCache().read();
        const invalidated = cached.invalidations[receipt.conversation.id];
        const isCurrentReceipt =
          epoch === cached.epoch &&
          (!invalidated || observedAtLeast(receipt.observation_cursor, invalidated));
        if (isCurrentReceipt) {
          this.mergeConversation(receipt.conversation);
          await this.acceptMessage(receipt.message);
        } else {
          await this.discard(receipt.message.id);
        }
      } catch (error) {
        if (isCancelled(error) || this.isDisposed) {
          return;
        }
        const isPermanent = error instanceof ApiError && !TRANSIENT_ERROR_CODES.has(error.code);
        if (isPermanent) {
          await this.failPending(pending, failureMessage(error));
        } else {
          this.replacePending({
            ...pending,
            status: 'queued',
            error: 'Waiting to retry safely.',
          });
        }
      }
    }
  }

  private async acceptMessage(message: CanonicalMessage): Promise<void> {
    this.explicitRetries.delete(message.id);
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
    if (message.is_deleted) {
      this.removeMessage(message.id);
      this.publish({ pending });
      return;
    }
    const isSelected = this.selectedConversation()?.id === message.conversation_id;
    const isVisible = this.snapshot.messages.some((candidate) => candidate.id === message.id);
    const load = this.historyLoad;
    if (isSelected && load?.edge === 'latest' && load.generation === this.viewGeneration) {
      // Sync advances independently of HTTP snapshots; retain arrivals until this page is installed.
      load.concurrentMessages = mergeMessages({
        current: load.concurrentMessages,
        incoming: [message],
        edge: 'latest',
      });
    }
    // An older request owns its original left edge. Appending here could evict the bridge row.
    const isLoadingOlder = load?.edge === 'older';
    const firstVisible = this.snapshot.messages[0];
    const lastVisible = this.snapshot.messages.at(-1);
    const isBeforeWindow =
      firstVisible && compareCounter(message.sequence, firstVisible.sequence) < 0;
    const hasSequenceGap =
      lastVisible && BigInt(message.sequence) > BigInt(lastVisible.sequence) + 1n;
    // A history snapshot can be newer than the feed cursor. Backlog must not create a remote gap.
    const canExtendWindow =
      !isBeforeWindow && !hasSequenceGap && !this.snapshot.hasNewer && !isLoadingOlder;
    const shouldRefreshLatest = isSelected && hasSequenceGap && !this.snapshot.hasNewer && !load;
    const canAppend = isSelected && (isVisible || canExtendWindow);
    const messages = canAppend
      ? mergeMessages({
          current: this.snapshot.messages,
          incoming: [message],
          edge: 'latest',
        })
      : this.snapshot.messages;
    this.publish({
      pending,
      messages: scrubReplySource(messages, message),
      precedingMessage: precedingMessage({
        messages,
        candidates: [this.snapshot.precedingMessage, ...this.snapshot.messages],
      }),
      hasNewer: this.snapshot.hasNewer || (isSelected && !isBeforeWindow && !canAppend),
      hasOlder:
        this.snapshot.hasOlder || (messages[0] !== undefined && messages[0].sequence !== '1'),
    });
    if (shouldRefreshLatest) {
      // A send receipt can overtake polling. Fetch a continuous latest page instead of stitching a gap.
      void this.loadHistory('latest').catch((error) => this.report(error));
    }
  }

  private mergeConversation(incoming: Conversation): void {
    const current = this.snapshot.conversations.find(
      (conversation) => conversation.id === incoming.id,
    );
    if (current && compareCounter(current.version, incoming.version) > 0) {
      return;
    }
    if (
      current &&
      current.generation !== incoming.generation &&
      this.selectedConversation()?.id === incoming.id
    ) {
      this.viewGeneration += 1;
      this.historyLoad = undefined;
      this.publish({
        messages: [],
        precedingMessage: undefined,
        isLoading: false,
        hasNewer: true,
      });
    }
    if (this.selectedConversation()?.id === incoming.id) {
      const local = this.snapshot.draft;
      const remote = restoreServerDraft(incoming.draft);
      const hasNewerDraft = compareCounter(incoming.draft.version, local.serverVersion ?? '0') > 0;
      if (hasNewerDraft && local.hasLocalChanges) {
        this.publish({ draftConflict: remote });
      } else if (hasNewerDraft) {
        this.publish({ draft: remote, draftConflict: undefined });
      }
    }
    const conversations = this.snapshot.conversations.filter(
      (conversation) => conversation.id !== incoming.id,
    );
    conversations.push(incoming);
    conversations.sort((first, second) => second.updated_at.localeCompare(first.updated_at));
    this.publish({ conversations });
  }

  private removeMessage(messageId: string): void {
    const messages = this.snapshot.messages.filter((message) => message.id !== messageId);
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.reply?.message_id === messageId) {
        messages[index] = {
          ...message,
          reply: {
            ...message.reply,
            is_unavailable: true,
            quote: null,
          },
        };
      }
    }
    if (this.historyLoad) {
      this.historyLoad.concurrentMessages = this.historyLoad.concurrentMessages.filter(
        (message) => message.id !== messageId,
      );
    }
    const precedingMessage =
      this.snapshot.precedingMessage?.id === messageId ? undefined : this.snapshot.precedingMessage;
    this.publish({ messages, precedingMessage });
  }

  private removeConversation(conversationId: string): void {
    if (this.selectedConversation()?.id === conversationId) {
      this.viewGeneration += 1;
      this.historyLoad = undefined;
      this.publish({
        messages: [],
        precedingMessage: undefined,
        isLoading: false,
      });
    }
    const conversations = this.snapshot.conversations.filter((item) => item.id !== conversationId);
    this.publish({ conversations });
  }

  private requireCache(): CanonicalCache {
    this.ensureCurrent();
    if (!this.cache) {
      throw new Error('Chat cache is not ready.');
    }
    return this.cache;
  }

  private async reloadSharedCache(): Promise<void> {
    const cached = await this.requireCache().read();
    this.ensureCurrent();
    const selectedId = this.selectedConversation()?.id;
    const hasReset = cached.epoch !== this.cacheSnapshot?.epoch;
    if (hasReset) {
      this.viewGeneration += 1;
      this.historyLoad = undefined;
      this.publish({
        messages: [],
        precedingMessage: undefined,
        isLoading: false,
      });
    }
    for (const conversation of cached.conversations) {
      this.mergeConversation(conversation);
    }
    this.cacheSnapshot = cached;
    this.cursor = cached.cursor;
    this.publish({ conversations: cached.conversations });
    for (const messageId of Object.keys(cached.removedMessages)) {
      this.removeMessage(messageId);
    }
    for (const conversationId of cached.removedConversations) {
      this.removeConversation(conversationId);
    }
    const page = selectedId ? cached.pages[selectedId] : undefined;
    if (page) {
      for (const message of page.messages) {
        await this.acceptMessage(message);
      }
    }
    const selected = this.selectedConversation();
    const last = this.snapshot.messages.at(-1);
    const hasUnfetchedMessages =
      selected && (!last || compareCounter(selected.last_sequence, last.sequence) > 0);
    if (hasUnfetchedMessages && !this.snapshot.hasNewer && !this.snapshot.isLoading) {
      await this.loadHistory('latest');
    }
  }

  private async resetCache(): Promise<void> {
    this.viewGeneration += 1;
    this.historyLoad = undefined;
    this.publish({
      messages: [],
      precedingMessage: undefined,
      isLoading: false,
    });
    const expected = await this.requireCache().read();
    const reply = await this.session.client.GET('/api/v1/chat/bootstrap');
    this.ensureCurrent();
    await this.requireCache().reset({ expected, bootstrap: requirePayload(reply) });
    await this.reloadSharedCache();
  }

  private scheduleDraft(): void {
    clearTimeout(this.draftTimer);
    if (this.snapshot.draftConflict || this.isDisposed) {
      return;
    }
    this.draftTimer = setTimeout(() => {
      void this.flushDraft().catch((error) => this.report(error));
    }, DRAFT_DEBOUNCE_MS);
  }

  private async saveRemoteDraft(): Promise<void> {
    const conversation = this.selectedConversation();
    const selection = this.snapshot.selection;
    const captured = this.snapshot.draft;
    if (!conversation || !selection || !captured.hasLocalChanges || this.snapshot.draftConflict) {
      return;
    }
    const destination = destinationKey(selection.destination);
    const hasContent = Boolean(captured.value.text || captured.value.richText);
    const request: components['schemas']['MessageCommand'] = {
      operation_id: captured.id,
      conversation_id: conversation.id,
      action: {
        kind: 'draft',
        expected_version: captured.serverVersion ?? '0',
        content: hasContent ? canonicalMessageContent(captured.value) : undefined,
        reply: captured.reply,
      },
    };
    const result = await this.postCommand(request);
    this.ensureCurrent();
    const receipt = result.receipt;
    if (result.isConflict) {
      if (receipt.conversation) {
        this.mergeConversation(receipt.conversation);
      }
      return;
    }
    const remote = receipt.conversation?.draft;
    if (!remote) {
      return;
    }
    const acknowledged: Draft = {
      ...captured,
      hasLocalChanges: false,
      serverVersion: remote.version,
    };
    await this.requireStore().acknowledgeDraft({ destination, draft: acknowledged });
    this.ensureCurrent();
    if (this.selectedConversation()?.id === conversation.id) {
      const current = this.snapshot.draft;
      if (current.id === captured.id) {
        this.publish({ draft: acknowledged });
      } else if (current.serverVersion === captured.serverVersion) {
        const rebased = { ...current, serverVersion: remote.version };
        await this.requireStore().acknowledgeDraft({ destination, draft: rebased });
        this.publish({ draft: rebased });
        this.scheduleDraft();
      }
    }
    if (receipt.conversation) {
      this.mergeConversation(receipt.conversation);
    }
  }

  private async failPending(pending: PendingMessage, error: string): Promise<void> {
    const failed: PendingMessage = {
      ...pending,
      status: 'failed',
      error,
    };
    // A delayed failure may arrive after discard or sync reconciliation removed this operation.
    if (await this.requireStore().updatePending(failed)) {
      this.replacePending(failed);
    }
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
    clearTimeout(this.expiryTimer);
    clearTimeout(this.draftTimer);
    this.isDisposed = true;
    this.snapshot = initialSnapshot();
    this.explicitRetries.clear();
    this.historyLoad = undefined;
    for (const listener of this.listeners) {
      listener();
    }
    // Retain a tombstone rather than deleting the key: another tab may still hold an old writer.
    void this.store?.invalidate().catch(() => undefined);
    void this.cache?.invalidate().catch(() => undefined);
  }

  private report(error: unknown): void {
    if (!this.isDisposed && !isCancelled(error)) {
      this.publish({ error: failureMessage(error) });
    }
  }

  private refreshVisibleExpiry(): void {
    clearTimeout(this.expiryTimer);
    const now = Date.now();
    let nextExpiry = Infinity;
    const expiredIds = new Set<string>();
    const affectedConversations = new Set<string>();
    for (const message of this.snapshot.messages) {
      if (!message.expires_at) {
        continue;
      }
      const deadline = Date.parse(message.expires_at);
      if (deadline <= now) {
        expiredIds.add(message.id);
        affectedConversations.add(message.conversation_id);
      } else {
        nextExpiry = Math.min(nextExpiry, deadline);
      }
    }
    if (expiredIds.size > 0) {
      const retained = this.snapshot.messages.filter((message) => !expiredIds.has(message.id));
      const messages = retained.map((message) => {
        if (!message.reply || !expiredIds.has(message.reply.message_id)) {
          return message;
        }
        return {
          ...message,
          reply: {
            ...message.reply,
            is_unavailable: true,
            quote: null,
          },
        };
      });
      const conversations = this.snapshot.conversations.map((conversation) => {
        return affectedConversations.has(conversation.id)
          ? { ...conversation, summary_text: '' }
          : conversation;
      });
      this.snapshot = {
        ...this.snapshot,
        messages,
        conversations,
      };
    }
    if (Number.isFinite(nextExpiry)) {
      // Local expiry remains active even when realtime and HTTP are both unavailable.
      const delay = Math.min(nextExpiry - now, MAX_TIMER_DELAY_MS);
      this.expiryTimer = setTimeout(() => this.publish({}), delay);
    }
  }

  private publish(change: Partial<ChatSnapshot>): void {
    if (this.isDisposed) {
      return;
    }
    this.snapshot = { ...this.snapshot, ...change };
    this.refreshVisibleExpiry();
    for (const listener of this.listeners) {
      listener();
    }
  }
}
