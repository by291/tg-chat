import { Centrifuge } from 'centrifuge';
import { showToast } from '@/components/toastStore';
import { ConnectedAlerts } from '@/features/settings/notifications/connectedAlerts';
import { playNotificationSound } from '@/features/settings/notifications/notificationDelivery';
import { CommunityOperations } from '@/features/communities/CommunityOperations';
import type { components } from '@/api/schema';
import { restoreServerDraft } from './draftModels';
import { CanonicalCache, observedAtLeast, type CanonicalSnapshot } from './canonicalCache';
import type { EmojiText } from '@/domain/messages/customEmoji';
import { ApiError, isCancelled, requirePayload, SessionOwner } from '@/features/auth/SessionOwner';
import { canonicalMessageContent } from './messageContent';
import type { SearchSenderRoster } from '../search/SearchSenderPicker';
import type { LoadMessageSearchPage } from '../search/useMessageSearch';
import { ChatMediaQueue } from './ChatMediaQueue';
import { uploadClient } from '@/features/media/uploadClient';
import {
  mediaFingerprint,
  pendingMedia,
  type MediaSelection,
  type UploadTransport,
} from '@/features/media/uploadTransfer';
import {
  compareCounter,
  destinationKey,
  MAX_VISIBLE_MESSAGES,
  mergeMessages,
  scrubReplySource,
  type CanonicalMessage,
  type Conversation,
  type Destination,
  type MessageBodyInput,
} from './messageModels';
import {
  redactDraftReply,
  scrubDraftReplyQuote,
  PendingMessages,
  type Draft,
  type PendingMessage,
  type PendingCommand,
  type PendingForward,
  type ForwardRequest,
} from './pendingMessages';

const RETRY_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
const MAX_BACKOFF_MS = 30_000;
const DRAFT_DEBOUNCE_MS = 500;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_ALERT_GROUPS = 200;
const MAX_ALERT_PREVIEW = 100;
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

type HistoryAnchor = { messageId: string; dateAt?: never } | { dateAt: string; messageId?: never };

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
  pendingForwards: PendingForward[];
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
    pendingForwards: [],
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
  communities?: CommunityOperations;
  private cache?: CanonicalCache;
  private cacheSnapshot?: CanonicalSnapshot;
  private snapshot = initialSnapshot();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private cursor = '';
  private viewGeneration = 0;
  private contactOpenGeneration = 0;
  private readonly alerts = new ConnectedAlerts();
  private activeAlertConversation?: string;
  private historyLoad?: HistoryLoad;
  private isDisposed = false;
  private syncPromise?: Promise<void>;
  private sendPromise?: Promise<void>;
  private forwardPromise?: Promise<void>;
  private mediaQueue?: ChatMediaQueue;
  private readonly mediaTransport: UploadTransport;
  private draftPromise?: Promise<void>;
  private draftTimer?: ReturnType<typeof setTimeout>;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private readonly summaryExpirations = new Map<string, string>();
  private readonly explicitRetries = new Set<string>();

  /** Own connected projections and pending work within one authenticated session generation. */
  constructor(options: {
    session: SessionOwner;
    store?: PendingMessages;
    mediaTransport?: UploadTransport;
  }) {
    this.session = options.session;
    this.store = options.store;
    this.mediaTransport = options.mediaTransport ?? uploadClient(this.session);
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
    this.observeAccountSettings(bootstrap.account_settings_version);
    this.store ??= new PendingMessages({
      key: `${bootstrap.deployment_id}:${this.userId}:${this.sessionId}`,
    });
    const persisted = await this.store.open();
    this.mediaQueue = new ChatMediaQueue({
      sessionId: this.sessionId,
      store: this.store,
      transport: this.mediaTransport,
      onPending: (message) => this.replacePending(message),
      onReady: () => {
        void this.sendPreparedMedia().catch((error) => this.report(error));
      },
    });
    this.ensureCurrent();
    this.cache ??= new CanonicalCache({
      key: `${bootstrap.deployment_id}:${this.userId}:${this.sessionId}`,
    });
    this.communities = new CommunityOperations({
      session: this.session,
      store: this.store,
      currentEpoch: () => this.cacheSnapshot?.epoch,
      applyReceipt: (input) => this.applyCommunityReceipt(input),
    });
    await this.communities.refresh();
    const cached = await this.cache.open(bootstrap);
    await this.reconcileDraftAccess(cached.conversations);
    this.ensureCurrent();
    this.cacheSnapshot = cached;
    this.cursor = cached.cursor;
    this.publish({
      conversations: cached.conversations,
      pendingCommands: persisted.commands ?? [],
      pendingForwards: persisted.forwards ?? [],
      pending: persisted.pending.map((message) => ({
        ...message,
        status: message.status === 'sending' ? 'queued' : message.status,
      })),
      isReady: true,
      error: '',
    });
    this.kickMedia();
    void this.flushForwards().catch((error) => this.report(error));
  }

  /** Poll serially while visible and catch up immediately after focus or network recovery. */
  connect({
    onActivityHint,
    onCallHint,
  }: {
    onActivityHint?: () => void;
    onCallHint?: () => void;
  } = {}): () => void {
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
        await this.pruneMediaSources();
        await this.catchUp();
        await this.flush();
        await this.flushForwards();
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
    realtime.on('connected', () => {
      this.alerts.resetBaseline();
      onCallHint?.();
      wake();
    });
    realtime.on('disconnected', () => this.alerts.resetBaseline());
    realtime.on('publication', (context) => {
      if (context.data?.kind === 'activity') {
        onActivityHint?.();
        return;
      }
      if (context.data?.kind === 'call') {
        onCallHint?.();
        return;
      }

      wake();
    });
    realtime.connect();
    watchCache();
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') {
        this.alerts.resetBaseline();
      }
      wake();
    };
    document.addEventListener('visibilitychange', visibilityChanged);

    return () => {
      isStopped = true;
      realtime.disconnect();
      unwatchCache?.();
      clearTimeout(timer);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }

  /** Suppress in-app alerts for the conversation currently visible in the workspace. */
  setAlertConversation(conversationId?: string): () => void {
    this.activeAlertConversation = conversationId;
    return () => {
      if (this.activeAlertConversation === conversationId) {
        this.activeAlertConversation = undefined;
      }
    };
  }

  /** Return to the conversation list and fence private reads from the previous selection. */
  showInbox(): void {
    this.ensureCurrent();
    void this.flushDraft().catch((error) => this.report(error));
    this.viewGeneration += 1;
    this.historyLoad = undefined;
    this.publish({
      selection: undefined,
      messages: [],
      precedingMessage: undefined,
      draft: emptyDraft(),
      draftConflict: undefined,
      draftAlternatives: [],
      editConflict: undefined,
      isLoading: false,
      hasOlder: false,
      hasNewer: false,
      navigation: undefined,
    });
  }

  /** Save one independent forwarding operation per destination before issuing any requests. */
  async queueForwards(input: { destinations: Destination[]; messageIds: string[] }): Promise<void> {
    this.ensureCurrent();
    const requests = input.destinations.map((destination): ForwardRequest => ({
      operation_id: crypto.randomUUID(),
      destination,
      items: input.messageIds.map((source_message_id) => ({
        source_message_id,
        message_id: crypto.randomUUID(),
      })),
    }));
    const store = this.requireStore();
    await store.rememberForwards(requests);
    const persisted = await store.read();
    this.ensureCurrent();
    this.publish({ pendingForwards: persisted.forwards ?? [] });
    void this.flushForwards().catch((error) => this.report(error));
  }

  /** Dismiss one definitively failed forwarding destination from the local outbox. */
  async dismissForward(operationId: string): Promise<void> {
    const store = this.requireStore();
    await store.removeForward(operationId);
    const persisted = await store.read();
    this.ensureCurrent();
    this.publish({ pendingForwards: persisted.forwards ?? [] });
  }

  private flushForwards(): Promise<void> {
    this.forwardPromise ??= this.sendForwards().finally(() => {
      this.forwardPromise = undefined;
    });
    return this.forwardPromise;
  }

  private async sendForwards(): Promise<void> {
    const store = this.requireStore();
    const persisted = await store.read();
    let didAccept = false;
    for (const entry of persisted.forwards ?? []) {
      if (!entry.error) {
        const didSend = await this.sendForward(entry.request);
        didAccept ||= didSend;
      }
    }
    const current = await store.read();
    this.ensureCurrent();
    this.publish({ pendingForwards: current.forwards ?? [] });
    if (didAccept) {
      await this.catchUp();
    }
  }

  private async sendForward(request: ForwardRequest): Promise<boolean> {
    this.ensureCurrent();
    const store = this.requireStore();
    try {
      const response = await this.session.client.POST('/api/v1/messages/forward', {
        body: request,
      });
      requirePayload(response);
      this.ensureCurrent();
      await store.removeForward(request.operation_id);
      return true;
    } catch (error) {
      this.ensureCurrent();
      // A transport failure can occur after commit. Keep the original request for reconciliation.
      if (error instanceof ApiError && !TRANSIENT_ERROR_CODES.has(error.code)) {
        await store.failForward({
          operationId: request.operation_id,
          error: failureMessage(error),
        });
      }
      return false;
    }
  }

  /** Invalidate a contact lookup when the user returns to the conversation list. */
  cancelContactOpen(): void {
    this.contactOpenGeneration += 1;
  }

  /** Resolve a shared account link while the initiating conversation still owns navigation. */
  async openContact(accountId: string): Promise<boolean> {
    this.ensureCurrent();
    const contactGeneration = ++this.contactOpenGeneration;
    const viewGeneration = this.viewGeneration;
    const isCurrentContact = () => contactGeneration === this.contactOpenGeneration;

    // Profile lookup is asynchronous, so a newer navigation must take precedence.
    const response = await this.session.client
      .GET('/api/v1/users/{user_id}', { params: { path: { user_id: accountId } } })
      .catch((error: unknown) => {
        if (isCurrentContact() && this.isCurrentView(viewGeneration)) {
          throw error;
        }
      });
    if (!response || !isCurrentContact() || !this.isCurrentView(viewGeneration)) {
      return false;
    }

    const profile = requirePayload(response);
    const selection: Selection =
      profile.id === this.userId
        ? { destination: { kind: 'saved' }, title: 'Saved Messages' }
        : {
            destination: { kind: 'recipient', user_id: profile.id },
            title: profile.display_name,
          };
    const selecting = this.select(selection);
    const selectedGeneration = this.viewGeneration;
    await selecting;

    return isCurrentContact() && this.isCurrentView(selectedGeneration);
  }

  /** Switch private history ownership before starting any remote page request. */
  async select(selection: Selection, options?: { messageId: string }): Promise<void> {
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
      if (options) {
        throw new DOMException('Another conversation replaced this jump.', 'AbortError');
      }
      return;
    }
    const key = destinationKey(selection.destination);
    const canonicalDraft = this.selectedConversation()?.draft;
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
    if (this.snapshot.draft.id === initialDraftId) {
      this.publish({
        draft,
        draftConflict: hasConflict ? remote : undefined,
        draftAlternatives: persisted.draftAlternatives?.[key] ?? [],
      });
    }
    if (options) {
      await this.jumpToMessage(options.messageId, { shouldRevalidate: true });
      return;
    }

    const conversation = this.selectedConversation();
    const cached = await this.requireCache().read();
    if (!this.isCurrentView(generation)) {
      return;
    }
    const page = conversation ? cached.pages[conversation.id] : undefined;
    if (page) {
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
      ...previous,
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

  /** Rebase local text only after the user chooses it over the competing server draft. */
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
    const target = this.snapshot.messages.find((message) => message.id === reply?.message_id);
    this.publish({
      draft: {
        ...this.snapshot.draft,
        reply,
        isReplyUnavailable: false,
        replyExpiresAt: target?.expires_at ?? undefined,
      },
    });
    await this.setDraft(this.snapshot.draft.value);
  }

  /** Persist before transport and preserve edits made while that write is pending. */
  async queueSend(value: EmojiText & { disableLinkPreview?: boolean }): Promise<void> {
    await this.queueMessage({ value, disableLinkPreview: value.disableLinkPreview });
  }

  /** Persist selected media and its caption together before the first upload request. */
  async enqueueMedia(input: {
    value: EmojiText;
    files: MediaSelection[];
    disableLinkPreview?: boolean;
  }): Promise<void> {
    if (input.files.length === 0) {
      throw new Error('Choose an attachment before sending.');
    }
    await this.queueMessage(input);
  }

  /** Queue an independent body without consuming the text draft or its reply. */
  async queueBody(body: MessageBodyInput): Promise<void> {
    await this.queueMessage({ value: { text: '' }, body });
  }

  private async queueMessage(input: {
    value: EmojiText;
    files?: MediaSelection[];
    body?: MessageBodyInput;
    disableLinkPreview?: boolean;
  }): Promise<void> {
    this.ensureCurrent();
    const selection = this.snapshot.selection;
    if (!selection) {
      return;
    }
    if (this.selectedConversation()?.can_post === false) {
      throw new Error('You do not have permission to post in this conversation.');
    }
    const isIndependent = input.body !== undefined;
    const capturedDraft = this.snapshot.draft;
    const draftId = capturedDraft.id;
    const generation = this.viewGeneration;
    if (!isIndependent && capturedDraft.isReplyUnavailable) {
      throw new Error('Remove the unavailable reply context before sending.');
    }
    // Draft delivery can help conditional clearing, but must never gate durable send admission.
    if (!isIndependent) {
      void this.flushDraft().catch((error) => this.report(error));
    }
    const content = canonicalMessageContent(input.value, {
      isCaption: isIndependent || Boolean(input.files),
    });
    const draft = isIndependent
      ? undefined
      : { destination: destinationKey(selection.destination), id: draftId };
    const pending: PendingMessage = {
      media: input.files?.map(pendingMedia),
      createdAt: Date.now(),
      title: selection.title,
      status: 'queued',
      // Independent bodies never participate in conditional server-side draft clearing.
      isPrepared: isIndependent,
      request: {
        operation_id: crypto.randomUUID(),
        message_id: crypto.randomUUID(),
        destination: selection.destination,
        content,
        reply: isIndependent ? undefined : capturedDraft.reply,
        body: input.body,
        disable_link_preview: input.disableLinkPreview,
      },
    };
    await this.requireStore().enqueue({
      message: pending,
      draft,
    });
    this.ensureCurrent();
    const canClearDraft =
      !isIndependent && this.isCurrentView(generation) && this.snapshot.draft.id === draftId;
    this.publish({
      pending: [...this.snapshot.pending, pending],
      draft: canClearDraft
        ? { ...emptyDraft(), serverVersion: capturedDraft.serverVersion }
        : this.snapshot.draft,
      error: '',
    });
    void this.flush().catch((error) => this.report(error));
  }

  /** Retry queued operations serially; an ambiguous response always reuses the original request. */
  flush(): Promise<void> {
    this.kickMedia();
    return this.flushText();
  }

  private kickMedia(): void {
    void this.mediaQueue?.kick(this.snapshot.pending).catch((error) => this.report(error));
  }

  private async sendPreparedMedia(): Promise<void> {
    await this.sendPromise;
    if (!this.isDisposed) {
      await this.flushText();
    }
  }

  private flushText(): Promise<void> {
    this.sendPromise ??= this.sendQueued().finally(() => {
      this.sendPromise = undefined;
    });
    return this.sendPromise;
  }

  private async pruneMediaSources(): Promise<void> {
    const cutoff = Date.now() - RETRY_LIFETIME_MS;
    const hasExpiredBytes = this.snapshot.pending.some((message) => {
      return message.media?.some((item) => {
        const savedAt = item.sourceSavedAt ?? message.createdAt;
        return savedAt <= cutoff && item.blob;
      });
    });
    if (!hasExpiredBytes) {
      return;
    }
    const persisted = await this.requireStore().pruneMedia();
    for (const message of persisted.pending) {
      if (message.media) {
        this.replacePending(message);
      }
    }
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
    if (pending.canRestartMedia) {
      const restarted = await this.requireStore().restartMedia(messageId);
      if (restarted) {
        const remaining = this.snapshot.pending.filter(
          (item) => item.request.message_id !== messageId,
        );
        this.publish({ pending: [...remaining, restarted] });
        this.kickMedia();
      }
      return;
    }
    const queued: PendingMessage = {
      ...pending,
      status: 'queued',
      error: undefined,
    };
    const updated = await this.requireStore().updatePending(queued);
    if (!updated) {
      return;
    }
    this.explicitRetries.add(messageId);
    this.replacePending(updated);
    await this.flush();
  }

  /** Recover one failed attachment without changing the pending message identity. */
  async restoreMediaSource(input: {
    messageId: string;
    occurrenceId: string;
    file: File;
  }): Promise<void> {
    const sha256 = await mediaFingerprint(input.file);
    const restored = await this.requireStore().restoreMediaSource({ ...input, sha256 });
    if (restored) {
      this.replacePending(restored);
      this.kickMedia();
    }
  }

  /** Remove a pending item without claiming that an ambiguous server send was cancelled. */
  async discard(messageId: string): Promise<void> {
    this.explicitRetries.delete(messageId);
    const store = this.requireStore();
    const persisted = await store.read();
    const pending = persisted.pending.find((message) => message.request.message_id === messageId);
    await store.remove(messageId);
    this.mediaQueue?.cancel(messageId);
    this.ensureCurrent();
    if (pending?.media && pending.isPrepared === false) {
      for (const item of pending.media) {
        const cancel = this.session.client.DELETE('/api/v1/media/uploads/{upload_id}', {
          params: { path: { upload_id: item.uploadId } },
        });
        // The server's expiration path also covers a lost cancellation response.
        void cancel.catch(() => undefined);
      }
    }
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

  private async applyCommunityReceipt(input: {
    conversationId: string;
    receipt: components['schemas']['CommandReceipt'];
    epoch?: string;
  }): Promise<void> {
    this.ensureCurrent();
    const epoch = input.epoch;
    if (!epoch) {
      throw new Error('Chat cache is not ready.');
    }
    const applied = await this.requireCache().applyReceipt({
      epoch,
      conversationId: input.conversationId,
      receipt: input.receipt,
    });
    this.ensureCurrent();
    if (applied) {
      await this.reloadSharedCache();
    }
    await this.catchUp();
  }

  /** Apply a desired-state action and retain its identity when confirmation is ambiguous. */
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

  /** Retry the persisted action only within receipt retention. */
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
    const didPersist = epoch
      ? await this.requireCache().applyReceipt({
          epoch,
          conversationId,
          receipt: result.receipt,
        })
      : false;
    await this.discardCommand(operationId);
    const cached = await this.requireCache().read();
    if (epoch !== cached.epoch) {
      await this.reloadSharedCache();
    }
    const invalidated = cached.invalidations[conversationId];
    const isCurrent =
      didPersist &&
      epoch === cached.epoch &&
      (!invalidated || observedAtLeast(result.receipt.observation_cursor, invalidated));
    if (isCurrent && result.receipt.conversation) {
      this.mergeConversation(result.receipt.conversation);
    } else if (isCurrent) {
      await this.removeConversation(conversationId);
    }
    if (isCurrent && result.receipt.message) {
      await this.acceptMessage(result.receipt.message);
    }
    if (result.isConflict) {
      const isAuthorized =
        isCurrent &&
        (await this.isReceiptCurrent({
          epoch,
          conversationId,
          receipt: result.receipt,
        }));
      if (action.kind === 'edit' && isAuthorized) {
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

  /** Identify the visibility checkpoint that owns the open search results. */
  searchVisibilityKey(conversationId?: string): string {
    const cached = this.cacheSnapshot;
    if (conversationId) {
      const conversation = this.snapshot.conversations.find((entry) => entry.id === conversationId);
      return JSON.stringify([
        cached?.epoch,
        conversation?.generation,
        cached?.invalidations[conversationId],
      ]);
    }
    const invalidations = Object.entries(cached?.invalidations ?? {});
    return JSON.stringify([cached?.epoch, invalidations]);
  }

  /** Load one search page and fence results against the latest shared visibility checkpoint. */
  searchMessages: LoadMessageSearchPage = async ({ query, signal }) => {
    const cache = this.requireCache();
    const before = await cache.read();
    const reply = await this.session.client.GET('/api/v1/chat/search', {
      params: { query },
      signal,
    });
    const page = requirePayload(reply);
    const after = await cache.read();
    this.ensureCurrent();
    const invalidated = query.conversation_id && after.invalidations[query.conversation_id];
    if (
      signal.aborted ||
      before.epoch !== after.epoch ||
      (invalidated && !observedAtLeast(page.observation_cursor, invalidated))
    ) {
      throw new DOMException('Search visibility changed while loading.', 'AbortError');
    }

    // A global page can contain projections from several independent visibility generations.
    const hits = page.hits.filter((message) => {
      const invalidation = after.invalidations[message.conversation_id];
      return (
        !after.removedMessages[message.id] &&
        (!invalidation || observedAtLeast(page.observation_cursor, invalidation))
      );
    });
    return { ...page, hits };
  };

  /** Read a page of group sender choices while the selected roster remains current. */
  loadSearchSenders: SearchSenderRoster['loadPage'] = async ({ conversationId, after }) => {
    this.ensureCurrent();
    const rosterGeneration = this.selectedConversation()?.generation;
    const generation = this.viewGeneration;
    const reply = await this.session.client.GET('/api/v1/communities/{conversation_id}/members', {
      params: { path: { conversation_id: conversationId }, query: { after } },
    });
    const conversation = this.selectedConversation();
    // Ordinary message traffic does not change roster visibility or interrupt pagination.
    const isCurrent =
      this.isCurrentView(generation) &&
      conversation?.id === conversationId &&
      conversation.generation === rosterGeneration;
    if (!isCurrent) {
      throw new DOMException('The conversation roster changed.', 'AbortError');
    }

    const page = requirePayload(reply);
    const active = page.items.filter((member) => member.is_active && !member.is_banned);
    const senders = active.map((member) => ({ id: member.id, name: member.display_name }));
    return { senders, next: page.next };
  };

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

  /** Page public voters within the current message and membership generation. */
  async loadPollVoters(input: {
    messageId: string;
    optionId?: string;
    after?: string;
    signal: AbortSignal;
  }): Promise<components['schemas']['PollVoterPage']> {
    const conversation = this.selectedConversation();
    if (!conversation) {
      throw new Error('Choose a conversation first.');
    }

    const generation = this.viewGeneration;
    const cachedBefore = await this.requireCache().read();
    const reply = await this.session.client.GET('/api/v1/messages/{message_id}/poll/voters', {
      params: {
        path: { message_id: input.messageId },
        query: { option_id: input.optionId, after: input.after },
      },
      signal: input.signal,
    });
    const page = requirePayload(reply);
    const cachedAfter = await this.requireCache().read();
    const message = this.snapshot.messages.find((entry) => entry.id === input.messageId);
    const poll = message?.body;
    const isExpired = message?.expires_at && Date.parse(message.expires_at) <= Date.now();
    const invalidatedBefore = cachedBefore.invalidations[conversation.id];
    const invalidatedAfter = cachedAfter.invalidations[conversation.id];
    // This response has no observation cursor, so any visibility change supersedes it.
    const isCurrent =
      !input.signal.aborted &&
      this.isCurrentView(generation) &&
      cachedBefore.epoch === cachedAfter.epoch &&
      invalidatedBefore === invalidatedAfter &&
      message?.conversation_id === conversation.id &&
      !message.is_deleted &&
      !isExpired &&
      poll?.kind === 'poll' &&
      !poll.is_anonymous &&
      poll.voter_count != null;
    if (!isCurrent) {
      throw new DOMException('The poll changed while loading voters.', 'AbortError');
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

  /** Reveal a reply target through its bounded authorized neighborhood. */
  async jumpToMessage(messageId: string, options?: { shouldRevalidate: boolean }): Promise<void> {
    const existing = this.snapshot.messages.find((message) => message.id === messageId);
    if (existing && !options?.shouldRevalidate) {
      this.publish({ navigation: { messageId, requestId: Date.now() } });
      return;
    }
    await this.loadHistory('latest', { messageId });
  }

  /** Reveal the first authorized message on or after a date, or the latest earlier message. */
  async jumpToDate(timestamp: number): Promise<void> {
    const dateAt = new Date(timestamp).toISOString();
    await this.loadHistory('latest', { dateAt });
  }

  /** Load bounded history and allow an explicit jump to supersede a pending edge request. */
  async loadHistory(edge: 'older' | 'latest', anchor?: HistoryAnchor): Promise<void> {
    this.ensureCurrent();
    const conversation = this.selectedConversation();
    if (!conversation) {
      if (anchor) {
        throw new ApiError({ code: 'not_found', message: 'Message unavailable' });
      }
      return;
    }
    if (this.snapshot.isLoading && !anchor) {
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
    const isCurrentLoad = () => this.historyLoad === load && this.isCurrentView(generation);
    const hasCurrentLoad = () => {
      const isCurrent = isCurrentLoad();
      if (!isCurrent && anchor) {
        throw new DOMException('Another history request replaced this jump.', 'AbortError');
      }
      return isCurrent;
    };
    this.publish({ isLoading: true });
    try {
      const reply = await this.session.client.GET(
        '/api/v1/conversations/{conversation_id}/history',
        {
          params: {
            path: { conversation_id: conversation.id },
            query: {
              before: edge === 'older' ? first?.sequence : undefined,
              around: anchor?.messageId,
              date_at: anchor?.dateAt,
            },
          },
        },
      );
      if (!hasCurrentLoad()) {
        return;
      }
      const page = requirePayload(reply);
      const anchorId = page.anchor_id ?? anchor?.messageId;
      if (anchor && !page.messages.some((message) => message.id === anchorId)) {
        throw new ApiError({ code: 'not_found', message: 'Message unavailable' });
      }
      const cached = await this.requireCache().read();
      if (!hasCurrentLoad()) {
        return;
      }
      if (epoch !== cached.epoch) {
        if (anchor) {
          throw new DOMException('History visibility changed while loading.', 'AbortError');
        }
        return;
      }
      const didSave = await this.requireCache().saveHistory({
        expected: cached,
        conversationId: conversation.id,
        page,
      });
      this.ensureCurrent();
      if (!hasCurrentLoad()) {
        return;
      }
      if (!didSave) {
        await this.reloadSharedCache();
        if (anchor) {
          const updated = this.selectedConversation();
          const invalidation = this.cacheSnapshot?.invalidations[conversation.id];
          const isUnavailable =
            updated?.id !== conversation.id ||
            updated.generation !== page.generation ||
            (invalidation && !observedAtLeast(page.observation_cursor, invalidation));
          if (isUnavailable) {
            throw new ApiError({ code: 'not_found', message: 'Message unavailable' });
          }
          throw new DOMException('History changed while opening the message.', 'AbortError');
        }
        this.publish({ hasNewer: true });
        return;
      }
      // A send or sync may have committed after the history snapshot began. Keep those newer rows.
      const firstSequence = page.messages[0]?.sequence;
      const candidates = [...this.snapshot.messages, ...load.concurrentMessages];
      const current = candidates.filter((message) => {
        if (anchor) {
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
        navigation: anchorId
          ? { messageId: anchorId, requestId: Date.now() }
          : this.snapshot.navigation,
        hasOlder: page.has_older,
        hasNewer: page.has_newer || hasTrimmedNewer || (edge === 'older' && this.snapshot.hasNewer),
        error: '',
      });
    } catch (error) {
      if (anchor) {
        throw error;
      }
      if (isCurrentLoad()) {
        this.report(error);
      }
    } finally {
      if (isCurrentLoad()) {
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
    this.mediaQueue?.close();
    this.unsubscribe();
    this.listeners.clear();
  }

  private async readChanges(): Promise<void> {
    this.ensureCurrent();
    let hasMore = true;
    const alertGroups: components['schemas']['SyncGroup'][] = [];
    while (hasMore) {
      const reply = await this.session.client.GET('/api/v1/chat/sync', {
        params: { query: { cursor: this.cursor } },
      });
      this.ensureCurrent();
      const page = requirePayload(reply);
      this.observeAccountSettings(page.account_settings_version);
      const expected = this.cacheSnapshot;
      if (!expected) {
        throw new Error('Chat cache is not ready.');
      }
      const didCommit = await this.requireCache().applySync({ expected, page });
      this.ensureCurrent();
      if (!didCommit) {
        await this.reloadSharedCache();
        const cached = this.cacheSnapshot!;
        const canApplyToView =
          cached.epoch === expected.epoch &&
          observedAtLeast(cached.cursor, page.cursor) &&
          observedAtLeast(page.observation_cursor, cached.cursor);
        if (canApplyToView) {
          await this.applyViewChanges(page);
          hasMore = page.has_more;
        }
        continue;
      }
      const committed = await this.requireCache().read();
      this.ensureCurrent();
      if (committed.cursor !== page.cursor || committed.epoch !== expected.epoch) {
        await this.reloadSharedCache();
        continue;
      }
      this.cacheSnapshot = committed;
      await this.applyViewChanges(page);
      alertGroups.push(...page.groups);
      const excess = alertGroups.length - MAX_ALERT_GROUPS;
      if (excess > 0) {
        alertGroups.splice(0, excess);
      }
      hasMore = page.has_more;
    }
    this.presentAlerts(alertGroups);
    this.publish({ error: '' });
  }

  private presentAlerts(groups: components['schemas']['SyncGroup'][]): void {
    const defaults = this.session.getSnapshot().preferences?.notification_defaults;
    const category = (kind: string) => {
      switch (kind) {
        case 'direct':
          return defaults?.private;
        case 'group':
          return defaults?.group;
        case 'channel':
          return defaults?.channel;
      }
    };
    const alerts = this.alerts.completeSync({
      groups,
      context: {
        userId: this.userId,
        isForeground: document.visibilityState === 'visible' && document.hasFocus(),
        conversations: this.snapshot.conversations,
        activeConversationId: this.activeAlertConversation,
        canNotify: (kind) =>
          Boolean(defaults?.should_show_notifications && category(kind)?.should_notify),
      },
    });
    const latest = alerts.at(-1);
    if (!latest) {
      return;
    }

    const conversation = this.snapshot.conversations.find(
      (entry) => entry.id === latest.conversationId,
    );
    // A later sync page may contain an edit to the same accepted message.
    const group = [...groups].reverse().find((entry) => entry.message?.id === latest.messageId);
    const canPreview = conversation && category(conversation.kind)?.should_show_preview;
    const preview = canPreview ? group?.message?.content.text.trim() : undefined;
    const text = preview ? Array.from(preview).slice(0, MAX_ALERT_PREVIEW).join('') : undefined;
    showToast(text ? `New message: ${text}` : 'New message', { isPassive: true });
    if (defaults?.should_play_sound) {
      void playNotificationSound({ volume: defaults.volume });
    }
  }

  private async applyViewChanges(page: components['schemas']['SyncPage']): Promise<void> {
    for (const group of page.groups) {
      if (group.conversation) {
        this.mergeConversation(group.conversation);
      } else {
        await this.removeConversation(group.conversation_id);
      }
      if (group.removed_message_id) {
        await this.invalidateMessage(group.removed_message_id);
      }
      if (group.message) {
        await this.acceptMessage(group.message);
      }
    }
    // Shared cache progress does not prove that this tab's independent window consumed the groups.
    this.cursor = page.cursor;
  }

  private async prepareSend(pending: PendingMessage): Promise<PendingMessage | undefined> {
    if (pending.isPrepared !== false) {
      return pending;
    }
    try {
      await this.draftPromise;
    } catch (error) {
      if (isCancelled(error)) {
        throw error;
      }
    }
    const serverDraft = this.findConversation(pending.request.destination)?.draft;
    const content = pending.request.content;
    const reply = pending.request.reply;
    const isMatchingDraft =
      serverDraft?.content?.text === content.text &&
      (serverDraft.content.rich_text ?? null) === (content.rich_text ?? null) &&
      JSON.stringify(serverDraft.content.custom_emoji) === JSON.stringify(content.custom_emoji) &&
      serverDraft.reply?.message_id === reply?.message_id &&
      (serverDraft.reply?.quote ?? null) === (reply?.quote ?? null);
    const prepared: PendingMessage = {
      ...pending,
      isPrepared: true,
      request: {
        ...pending.request,
        draft_version: isMatchingDraft ? serverDraft?.version : undefined,
      },
    };
    // Freeze the wire payload durably before its first attempt, including after reload.
    const updated = await this.requireStore().updatePending(prepared);
    if (updated) {
      this.replacePending(updated);
    }
    return updated;
  }

  private async sendQueued(): Promise<void> {
    for (const entry of this.snapshot.pending) {
      const isWaitingForMedia = entry.media?.length && !entry.request.attachments?.length;
      if (this.isDisposed || entry.status === 'failed' || isWaitingForMedia) {
        continue;
      }
      const pending = await this.prepareSend(entry);
      if (!pending) {
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
        const didPersist = epoch
          ? await this.requireCache().applyReceipt({
              epoch,
              conversationId: receipt.conversation.id,
              receipt,
            })
          : false;
        const cached = await this.requireCache().read();
        if (epoch !== cached.epoch) {
          await this.reloadSharedCache();
        }
        const invalidated = cached.invalidations[receipt.conversation.id];
        const isCurrentReceipt =
          didPersist &&
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
          const canRestartMedia = error.code === 'media_file_unavailable' && Boolean(pending.media);
          await this.failPending({ ...pending, canRestartMedia }, failureMessage(error));
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
      await this.invalidateMessage(message.id);
      this.publish({ pending });
      return;
    }
    if (compareCounter(message.version, '1') > 0) {
      const source = { messageId: message.id, text: message.content.text };
      const conflict = this.snapshot.draftConflict;
      this.publish({
        draft: scrubDraftReplyQuote(this.snapshot.draft, source),
        draftConflict: conflict ? scrubDraftReplyQuote(conflict, source) : undefined,
        draftAlternatives: this.snapshot.draftAlternatives?.map((draft) =>
          scrubDraftReplyQuote(draft, source),
        ),
      });
      await this.requireStore().scrubReplyQuote(source);
      this.ensureCurrent();
    }
    const isSelected = this.selectedConversation()?.id === message.conversation_id;
    const isVisible = this.snapshot.messages.some((candidate) => candidate.id === message.id);
    const load = this.historyLoad;
    if (isSelected && load?.edge === 'latest' && load.generation === this.viewGeneration) {
      // Sync advances independently of HTTP; retain arrivals until this page is installed.
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
      // Receipts can overtake polling; fetch a continuous latest page to avoid a gap.
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
    if (current?.last_sequence !== incoming.last_sequence) {
      this.summaryExpirations.delete(incoming.id);
    }
    if (
      current &&
      current.generation !== incoming.generation &&
      this.selectedConversation()?.id === incoming.id
    ) {
      this.redactAccessReplies(incoming.clear_through);
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
      const targetId = incoming.draft.reply?.message_id;
      if (targetId && incoming.draft.is_reply_unavailable) {
        this.removeMessage(targetId);
        void this.requireStore()
          .redactReply(targetId)
          .catch((error) => this.report(error));
      }
      const local = this.snapshot.draft;
      const remote = restoreServerDraft(incoming.draft);
      remote.replyRevision = local.replyRevision;
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

  private async invalidateMessage(messageId: string): Promise<void> {
    this.removeMessage(messageId);
    await this.requireStore().redactReply(messageId);
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
    this.publish({
      messages,
      precedingMessage,
      draft: redactDraftReply(this.snapshot.draft, messageId),
      draftConflict: this.snapshot.draftConflict
        ? redactDraftReply(this.snapshot.draftConflict, messageId)
        : undefined,
      draftAlternatives: this.snapshot.draftAlternatives?.map((draft) =>
        redactDraftReply(draft, messageId),
      ),
    });
  }

  private redactAccessReplies(clearThrough?: string): void {
    const drafts = [
      this.snapshot.draft,
      this.snapshot.draftConflict,
      ...(this.snapshot.draftAlternatives ?? []),
    ];
    for (const draft of drafts) {
      if (!draft?.reply) {
        continue;
      }
      const targetId = draft.reply.message_id;
      const target = this.snapshot.messages.find((message) => message.id === targetId);
      if (target && clearThrough && compareCounter(target.sequence, clearThrough) > 0) {
        continue;
      }
      this.removeMessage(targetId);
      void this.requireStore()
        .redactReply(targetId)
        .catch((error) => this.report(error));
    }
  }

  private async removeConversation(conversationId: string): Promise<void> {
    const conversation = this.snapshot.conversations.find((entry) => entry.id === conversationId);
    const destinations = [`conversation:${conversationId}`];
    if (conversation?.kind === 'direct') {
      destinations.push(`recipient:${conversation.peer_id}`);
    }
    if (conversation?.kind === 'saved') {
      destinations.push('saved');
    }
    await this.requireStore().redactConversationReplies(destinations);
    const persisted = await this.requireStore().read();
    this.ensureCurrent();

    if (this.selectedConversation()?.id === conversationId) {
      this.redactAccessReplies();
      this.viewGeneration += 1;
      this.historyLoad = undefined;
      const destination = destinationKey(this.snapshot.selection!.destination);
      this.publish({
        messages: [],
        precedingMessage: undefined,
        draft: persisted.drafts[destination] ?? this.snapshot.draft,
        draftConflict: undefined,
        draftAlternatives: persisted.draftAlternatives?.[destination] ?? [],
        isLoading: false,
      });
    }
    const editConflict =
      this.snapshot.editConflict?.conversation_id === conversationId
        ? undefined
        : this.snapshot.editConflict;
    const conversations = this.snapshot.conversations.filter((item) => item.id !== conversationId);
    this.summaryExpirations.delete(conversationId);
    this.publish({ conversations, editConflict });
  }

  private async reconcileDraftAccess(conversations: Conversation[]): Promise<void> {
    const authorized = new Set(
      conversations.map((conversation) => `conversation:${conversation.id}`),
    );
    const persisted = await this.requireStore().read();
    const destinations = new Set([
      ...Object.keys(persisted.drafts),
      ...Object.keys(persisted.draftAlternatives ?? {}),
    ]);
    const revoked = Array.from(destinations).filter((destination) => {
      return destination.startsWith('conversation:') && !authorized.has(destination);
    });
    if (revoked.length > 0) {
      await this.requireStore().redactConversationReplies(revoked);
    }
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
      await this.reconcileDraftAccess(cached.conversations);
      this.viewGeneration += 1;
      this.historyLoad = undefined;
      this.publish({
        messages: [],
        precedingMessage: undefined,
        isLoading: false,
      });
    }
    if (
      selectedId &&
      !cached.conversations.some((conversation) => conversation.id === selectedId)
    ) {
      await this.removeConversation(selectedId);
    }
    for (const conversation of cached.conversations) {
      this.mergeConversation(conversation);
    }
    this.cacheSnapshot = cached;
    if (hasReset) {
      this.cursor = cached.cursor;
    }
    this.publish({ conversations: cached.conversations });
    for (const messageId of Object.keys(cached.removedMessages)) {
      await this.invalidateMessage(messageId);
    }
    for (const conversationId of cached.removedConversations) {
      await this.removeConversation(conversationId);
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
    this.alerts.resetBaseline();
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
    const bootstrap = requirePayload(reply);
    this.observeAccountSettings(bootstrap.account_settings_version);
    await this.requireCache().reset({ expected, bootstrap });
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

  private observeAccountSettings(version?: string): void {
    if (!version) {
      return;
    }

    // Account settings refresh independently of chat cache commits and history recovery.
    void this.session.refreshAccountSettings(version).catch(() => undefined);
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
    const epoch = this.cacheSnapshot?.epoch;
    const result = await this.postCommand(request);
    this.ensureCurrent();
    const receipt = result.receipt;
    const didPersist = epoch
      ? await this.requireCache().applyReceipt({
          epoch,
          conversationId: conversation.id,
          receipt,
        })
      : false;
    if (
      !didPersist ||
      !(await this.isReceiptCurrent({
        epoch,
        receipt,
        conversationId: conversation.id,
      }))
    ) {
      await this.reloadSharedCache();
      return;
    }
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
      isReplyUnavailable: remote.is_reply_unavailable ?? captured.isReplyUnavailable,
      replyExpiresAt: remote.reply_expires_at ?? captured.replyExpiresAt,
    };
    await this.requireStore().acknowledgeDraft({
      destination,
      draft: acknowledged,
      previousServerVersion: captured.serverVersion ?? '0',
    });
    const persisted = await this.requireStore().read();
    if (
      !(await this.isReceiptCurrent({
        epoch,
        receipt,
        conversationId: conversation.id,
      }))
    ) {
      await this.reloadSharedCache();
      return;
    }
    this.ensureCurrent();
    const updated = persisted.drafts[destination];
    const isSelected = this.selectedConversation()?.id === conversation.id;
    if (isSelected && updated?.id === this.snapshot.draft.id) {
      this.publish({ draft: updated });
      if (updated.hasLocalChanges) {
        this.scheduleDraft();
      }
    }
    if (receipt.conversation) {
      this.mergeConversation(receipt.conversation);
    }
  }

  private async isReceiptCurrent(input: {
    epoch?: string;
    receipt: components['schemas']['CommandReceipt'];
    conversationId: string;
  }): Promise<boolean> {
    const cached = await this.requireCache().read();
    this.ensureCurrent();
    const invalidated = cached.invalidations[input.conversationId];
    return (
      cached.epoch === input.epoch &&
      (!invalidated || observedAtLeast(input.receipt.observation_cursor, invalidated))
    );
  }

  private async failPending(pending: PendingMessage, error: string): Promise<void> {
    const failed: PendingMessage = {
      ...pending,
      status: 'failed',
      error,
    };
    // A delayed failure may arrive after discard or sync reconciliation removed this operation.
    const updated = await this.requireStore().updatePending(failed);
    if (updated) {
      this.replacePending(updated);
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
    const conversationsById = new Map(
      this.snapshot.conversations.map((entry) => [entry.id, entry]),
    );
    const observeSource = (messageId: string, expiresAt?: string | null) => {
      if (!expiresAt) {
        return;
      }
      const deadline = Date.parse(expiresAt);
      if (deadline <= now) {
        expiredIds.add(messageId);
      } else {
        nextExpiry = Math.min(nextExpiry, deadline);
      }
    };
    for (const message of this.snapshot.messages) {
      observeSource(message.id, message.expires_at);
      if (message.reply && !message.reply.is_unavailable) {
        observeSource(message.reply.message_id, message.reply.expires_at);
      }
      const conversation = conversationsById.get(message.conversation_id);
      if (message.expires_at && conversation?.last_sequence === message.sequence) {
        this.summaryExpirations.set(conversation.id, message.expires_at);
      }
    }
    const drafts = [
      this.snapshot.draft,
      this.snapshot.draftConflict,
      ...(this.snapshot.draftAlternatives ?? []),
    ];
    for (const draft of drafts) {
      if (draft?.reply && !draft.isReplyUnavailable) {
        observeSource(draft.reply.message_id, draft.replyExpiresAt);
      }
    }
    const conversations = this.snapshot.conversations.map((original) => {
      let conversation = original;
      const postingDeadline = original.posting_muted_until;
      // Restore only a timed UI capability; the server still authorizes every publication.
      if (original.kind === 'group' && !original.can_post && postingDeadline) {
        const deadline = Date.parse(postingDeadline);
        if (deadline <= now) {
          conversation = { ...original, can_post: true };
        } else {
          nextExpiry = Math.min(nextExpiry, deadline);
        }
      }
      const expiresAt =
        conversation.summary_expires_at === undefined
          ? this.summaryExpirations.get(conversation.id)
          : conversation.summary_expires_at;
      if (!expiresAt) {
        return conversation;
      }
      const deadline = Date.parse(expiresAt);
      if (deadline > now) {
        nextExpiry = Math.min(nextExpiry, deadline);
        return conversation;
      }
      return {
        ...conversation,
        summary_text: '',
        summary_expires_at: null,
        summary_created_at: null,
      };
    });
    this.snapshot = { ...this.snapshot, conversations };
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
      let draft = this.snapshot.draft;
      let draftConflict = this.snapshot.draftConflict;
      let draftAlternatives = this.snapshot.draftAlternatives;
      for (const messageId of expiredIds) {
        draft = redactDraftReply(draft, messageId);
        draftConflict = draftConflict ? redactDraftReply(draftConflict, messageId) : undefined;
        draftAlternatives = draftAlternatives?.map((entry) => redactDraftReply(entry, messageId));
        void this.store?.redactReply(messageId).catch((error) => this.report(error));
      }
      this.snapshot = {
        ...this.snapshot,
        messages,
        draft,
        draftConflict,
        draftAlternatives,
      };
    }
    if (Number.isFinite(nextExpiry)) {
      // All visible projections own their deadline independently of Worker or network availability.
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
