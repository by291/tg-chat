import { get, update } from 'idb-keyval';
import type { components } from '@/api/schema';
import type { EmojiText } from '@/domain/messages/customEmoji';
import type { PendingMedia, UploadProgress } from '@/features/media/uploadTransfer';

const MAX_PENDING_MESSAGES = 100;
const MAX_PENDING_FORWARDS = 100;
const MAX_DRAFTS = 201;
const MAX_DRAFT_ALTERNATIVES = 5;
const MAX_PENDING_MEDIA_BYTES = 512 * 1024 * 1024;
const MEDIA_CLAIM_MS = 90_000;
const MEDIA_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingMessage {
  request: components['schemas']['SendMessage'];
  createdAt: number;
  isPrepared?: boolean;
  shouldPreserveDraft?: boolean;
  title?: string;
  status: 'queued' | 'sending' | 'failed';
  error?: string;
  media?: PendingMedia[];
  mediaClaim?: { token: string; expiresAt: number };
  mediaProgress?: UploadProgress;
  canRestartMedia?: boolean;
}

export interface PendingCommand {
  request: components['schemas']['MessageCommand'];
  createdAt: number;
}

export interface ForwardRequest {
  operation_id: string;
  destination: components['schemas']['Destination'];
  items: { source_message_id: string; message_id: string }[];
}

export interface PendingForward {
  request: ForwardRequest;
  error?: string;
}

export type PendingCommunityOperation =
  | {
      kind: 'create';
      request: components['schemas']['CreateCommunity'];
      createdAt: number;
    }
  | {
      kind: 'command';
      request: components['schemas']['CommunityCommand'];
      createdAt: number;
    };

export interface Draft {
  id: string;
  value: EmojiText;
  serverVersion?: string;
  hasLocalChanges?: boolean;
  replyRevision?: number;
  isReplyUnavailable?: boolean;
  replyExpiresAt?: string;
  reply?: components['schemas']['ReplyInput'];
}

export interface PendingSnapshot {
  isActive: boolean;
  pending: PendingMessage[];
  drafts: Record<string, Draft>;
  draftAlternatives?: Record<string, Draft[]>;
  commands?: PendingCommand[];
  forwards?: PendingForward[];
  communities?: PendingCommunityOperation[];
  replyRevisions?: Record<string, number>;
}

interface EnqueueOptions {
  message: PendingMessage;
  draft?: { destination: string; id: string };
}

interface MediaClaim {
  messageId: string;
  token: string;
}

interface MediaRecovery {
  messageId: string;
  occurrenceId: string;
  file: File;
  sha256: string;
}

interface MediaCheckpoint extends MediaClaim {
  item: PendingMedia;
}

function dropExpiredBlobs(snapshot: PendingSnapshot): void {
  const cutoff = Date.now() - MEDIA_RETENTION_MS;
  for (const pending of snapshot.pending) {
    if (!pending.media) {
      continue;
    }
    pending.media = pending.media.map((item) => {
      const savedAt = item.sourceSavedAt ?? pending.createdAt;
      return savedAt <= cutoff && item.blob ? { ...item, blob: undefined } : item;
    });
  }
}

function queuedBytes(message: PendingMessage): number {
  return message.media?.reduce((bytes, item) => bytes + (item.blob?.size ?? 0), 0) ?? 0;
}

function pendingIndex(snapshot: PendingSnapshot, messageId: string): number {
  return snapshot.pending.findIndex((message) => message.request.message_id === messageId);
}

function communityIntent(operation: PendingCommunityOperation): string {
  if (operation.kind === 'create') {
    const { operation_id, conversation_id, ...settings } = operation.request;
    return JSON.stringify({ kind: operation.kind, settings });
  }
  const { operation_id, ...request } = operation.request;
  return JSON.stringify({ kind: operation.kind, request });
}

function protectDraftReplies(input: { draft: Draft; revision: number }): Draft {
  const draft = input.draft;
  if ((draft.replyRevision ?? 0) === input.revision) {
    return draft;
  }
  // A writer captured before access removal cannot restore an excerpt after the removal commits.
  const redacted = draft.reply ? redactDraftReply(draft, draft.reply.message_id) : draft;
  return { ...redacted, replyRevision: input.revision };
}

function acknowledgeCurrentDraft(current: Draft, acknowledged: Draft): Draft {
  const updated = {
    ...current,
    hasLocalChanges: acknowledged.hasLocalChanges,
    serverVersion: acknowledged.serverVersion,
    replyExpiresAt: acknowledged.replyExpiresAt,
  };
  if (acknowledged.isReplyUnavailable && current.reply) {
    return redactDraftReply(updated, current.reply.message_id);
  }
  return updated;
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

/** Scrub only inaccessible reply context while preserving independent text and draft revision. */
export function redactDraftReply(draft: Draft, messageId: string): Draft {
  if (draft.reply?.message_id !== messageId) {
    return draft;
  }
  return {
    ...draft,
    reply: { ...draft.reply, quote: null },
    isReplyUnavailable: true,
  };
}

/** Discard a stale excerpt after an edit without making its still-accessible source unavailable. */
export function scrubDraftReplyQuote(
  draft: Draft,
  source: { messageId: string; text: string },
): Draft {
  const reply = draft.reply;
  if (reply?.message_id !== source.messageId || !reply.quote || source.text.includes(reply.quote)) {
    return draft;
  }
  return { ...draft, reply: { ...reply, quote: null } };
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
      const snapshot = existing ? requireActive(existing) : emptySnapshot();
      dropExpiredBlobs(snapshot);
      return snapshot;
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
    await this.enqueueMany({ messages: [options.message], draft: options.draft });
  }

  /** Admit a whole batch and its draft update in a single browser-storage transaction. */
  async enqueueMany(options: { messages: PendingMessage[]; draft?: EnqueueOptions['draft'] }) {
    const { messages, draft } = options;
    const identities = new Set(messages.map((message) => message.request.message_id));
    if (identities.size !== messages.length) {
      throw new Error('Duplicate pending message identity.');
    }

    await this.mutate((snapshot) => {
      dropExpiredBlobs(snapshot);
      const remaining = snapshot.pending.filter((message) => {
        return !identities.has(message.request.message_id);
      });
      const pending = [...remaining, ...messages];
      if (pending.length > MAX_PENDING_MESSAGES) {
        throw new Error('There are already 100 pending messages. Retry or discard one first.');
      }

      if (messages.some((message) => message.media)) {
        const totalBytes = pending.reduce((total, message) => total + queuedBytes(message), 0);
        if (totalBytes > MAX_PENDING_MEDIA_BYTES) {
          throw new Error('Pending media storage is full. Retry or discard an upload first.');
        }
      }

      snapshot.pending = pending;
      if (draft && snapshot.drafts[draft.destination]?.id === draft.id) {
        delete snapshot.drafts[draft.destination];
      }
    });
  }

  /** Change an existing operation without reviving one removed by another task or tab. */
  async updatePending(
    message: PendingMessage,
    options: { mediaToken?: string } = {},
  ): Promise<PendingMessage | undefined> {
    let updated: PendingMessage | undefined;
    await this.mutate((snapshot) => {
      const index = snapshot.pending.findIndex((current) => {
        return current.request.message_id === message.request.message_id;
      });
      if (index < 0) {
        return;
      }
      const current = snapshot.pending[index];
      if (options.mediaToken && current.mediaClaim?.token !== options.mediaToken) {
        return;
      }
      // The first prepared payload wins across tabs; later status changes cannot change its hash.
      const hasFrozenRequest = current.isPrepared !== false;
      updated = {
        ...message,
        request: hasFrozenRequest
          ? current.request
          : { ...message.request, attachments: current.request.attachments },
        isPrepared: hasFrozenRequest ? current.isPrepared : message.isPrepared,
        media: current.media,
        mediaClaim: current.mediaClaim,
        mediaProgress: undefined,
      };
      snapshot.pending[index] = updated;
    });

    return updated;
  }

  /** Drop expired source bytes while retaining enough state to reconcile a send. */
  async pruneMedia(): Promise<PendingSnapshot> {
    await this.mutate(dropExpiredBlobs);
    return this.read();
  }

  /** Allocate a new operation only after the previous send definitively failed at acceptance. */
  async restartMedia(messageId: string): Promise<PendingMessage | undefined> {
    let restarted: PendingMessage | undefined;
    await this.mutate((snapshot) => {
      dropExpiredBlobs(snapshot);
      const index = pendingIndex(snapshot, messageId);
      const current = snapshot.pending[index];
      if (!current?.media || !current.canRestartMedia || current.status !== 'failed') {
        return;
      }
      restarted = {
        ...current,
        status: 'queued',
        error: undefined,
        isPrepared: false,
        canRestartMedia: false,
        mediaClaim: undefined,
        mediaProgress: undefined,
        createdAt: Date.now(),
        media: current.media.map((item) => ({
          ...item,
          sourceSavedAt: item.sourceSavedAt ?? current.createdAt,
          fileId: undefined,
        })),
        request: {
          ...current.request,
          attachments: undefined,
          draft_version: undefined,
          message_id: crypto.randomUUID(),
          operation_id: crypto.randomUUID(),
        },
      };
      snapshot.pending[index] = restarted;
    });
    return restarted;
  }

  /** Claim a pending upload across tabs before reading or transferring its source bytes. */
  async claimMedia(input: {
    messageId: string;
    hasBrowserLock?: boolean;
  }): Promise<PendingMessage['mediaClaim']> {
    let claim: PendingMessage['mediaClaim'];
    await this.mutate((snapshot) => {
      const index = pendingIndex(snapshot, input.messageId);
      const current = snapshot.pending[index];
      if (!current?.media || current.status === 'failed' || current.request.attachments?.length) {
        return;
      }
      const now = Date.now();
      const hasLiveClaim = current.mediaClaim && current.mediaClaim.expiresAt > now;
      if (hasLiveClaim && !input.hasBrowserLock) {
        return;
      }
      // The browser lock survives only while its owning document is alive.
      claim = { token: crypto.randomUUID(), expiresAt: now + MEDIA_CLAIM_MS };
      snapshot.pending[index] = { ...current, mediaClaim: claim };
    });
    return claim;
  }

  /** Save one attachment and atomically publish the send payload when every item is ready. */
  async checkpointMedia(input: MediaCheckpoint): Promise<PendingMessage | undefined> {
    let checkpoint: PendingMessage | undefined;
    await this.mutate((snapshot) => {
      const index = pendingIndex(snapshot, input.messageId);
      const current = snapshot.pending[index];
      if (!current?.media || current.mediaClaim?.token !== input.token) {
        return;
      }
      dropExpiredBlobs(snapshot);
      // A tab may hold old bytes in memory after the current IndexedDB source expired.
      const media = current.media.map((item) =>
        item.occurrenceId === input.item.occurrenceId ? { ...input.item, blob: item.blob } : item,
      );
      const attachments = media.flatMap((item) =>
        item.fileId ? [{ occurrence_id: item.occurrenceId, file_id: item.fileId }] : [],
      );
      checkpoint = {
        ...current,
        media,
        mediaClaim: { token: input.token, expiresAt: Date.now() + MEDIA_CLAIM_MS },
        request: {
          ...current.request,
          attachments: attachments.length === media.length ? attachments : undefined,
        },
      };
      snapshot.pending[index] = checkpoint;
    });
    return checkpoint;
  }

  /** Restore a missing source or replace one rejected item before freezing the message. */
  async restoreMediaSource(input: MediaRecovery): Promise<PendingMessage | undefined> {
    let restored: PendingMessage | undefined;
    await this.mutate((snapshot) => {
      const index = pendingIndex(snapshot, input.messageId);
      const current = snapshot.pending[index];
      if (!current?.media || current.isPrepared !== false || current.status !== 'failed') {
        return;
      }
      const item = current.media.find((entry) => entry.occurrenceId === input.occurrenceId);
      if (!item || item.fileId) {
        return;
      }
      const isOriginal =
        item.sizeBytes === input.file.size && (!item.sha256 || item.sha256 === input.sha256);
      if (!item.blob && !isOriginal) {
        throw new Error('The selected file does not match the original upload.');
      }
      const bytes = snapshot.pending.reduce((total, entry) => total + queuedBytes(entry), 0);
      if (bytes - (item.blob?.size ?? 0) + input.file.size > MAX_PENDING_MEDIA_BYTES) {
        throw new Error('Pending media storage is full. Retry or discard an upload first.');
      }
      const replacement: PendingMedia = {
        ...item,
        filename: isOriginal ? item.filename : input.file.name,
        sizeBytes: input.file.size,
        sourceSavedAt: Date.now(),
        uploadId: !item.blob && isOriginal ? item.uploadId : crypto.randomUUID(),
        sha256: input.sha256,
        blob: input.file,
      };
      restored = {
        ...current,
        mediaClaim: undefined,
        mediaProgress: undefined,
        status: 'queued',
        error: undefined,
        media: current.media.map((entry) => (entry === item ? replacement : entry)),
      };
      snapshot.pending[index] = restored;
    });
    return restored;
  }

  /** Release the claim without changing work that another tab already recovered. */
  async releaseMedia(input: MediaClaim): Promise<void> {
    await this.mutate((snapshot) => {
      const index = pendingIndex(snapshot, input.messageId);
      const current = snapshot.pending[index];
      if (current?.mediaClaim?.token === input.token) {
        snapshot.pending[index] = { ...current, mediaClaim: undefined };
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

  /** Persist every destination before any request can be sent or the picker can close. */
  async rememberForwards(requests: ForwardRequest[]): Promise<void> {
    await this.mutate((snapshot) => {
      const current = snapshot.forwards ?? [];
      const known = new Set(current.map(({ request }) => request.operation_id));
      const added = requests.filter((request) => !known.has(request.operation_id));
      if (current.length + added.length > MAX_PENDING_FORWARDS) {
        throw new Error('There are too many pending forwards.');
      }

      snapshot.forwards = [...current, ...added.map((request) => ({ request }))];
    });
  }

  /** Remove only the acknowledged or discarded forwarding destination. */
  async removeForward(operationId: string): Promise<void> {
    await this.mutate((snapshot) => {
      const current = snapshot.forwards ?? [];
      snapshot.forwards = current.filter(({ request }) => request.operation_id !== operationId);
    });
  }

  /** Preserve a terminal forwarding error without retrying other destinations. */
  async failForward(input: { operationId: string; error: string }): Promise<void> {
    await this.mutate((snapshot) => {
      const current = snapshot.forwards ?? [];
      snapshot.forwards = current.map((entry) => {
        if (entry.request.operation_id !== input.operationId) {
          return entry;
        }
        return { ...entry, error: input.error };
      });
    });
  }

  /** Forget an acknowledged or explicitly abandoned action without implying server cancellation. */
  async removeCommand(operationId: string): Promise<void> {
    await this.mutate((snapshot) => {
      snapshot.commands = snapshot.commands?.filter(
        (entry) => entry.request.operation_id !== operationId,
      );
    });
  }

  /** Retain one community mutation before transport and reuse an unresolved identical intent. */
  async rememberCommunity(
    operation: PendingCommunityOperation,
  ): Promise<PendingCommunityOperation> {
    let remembered = operation;
    await this.mutate((snapshot) => {
      snapshot.communities ??= [];
      const intent = communityIntent(operation);
      const existing = snapshot.communities.find((entry) => communityIntent(entry) === intent);
      if (existing) {
        remembered = existing;
        return;
      }
      if (snapshot.communities.length >= MAX_PENDING_MESSAGES) {
        throw new Error('Resolve pending community actions before creating another one.');
      }
      snapshot.communities.push(operation);
    });
    return remembered;
  }

  /** Remove only the acknowledged or explicitly dismissed community operation. */
  async removeCommunity(operationId: string): Promise<void> {
    await this.mutate((snapshot) => {
      snapshot.communities = snapshot.communities?.filter(
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
      const draft = protectDraftReplies({
        draft: options.draft,
        revision: snapshot.replyRevisions?.[options.destination] ?? 0,
      });
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
      snapshot.drafts[options.destination] = draft;
    });
    return conflict;
  }

  /** Acknowledge the owned draft revision while preserving newer typing and alternatives. */
  async acknowledgeDraft(options: {
    destination: string;
    draft: Draft;
    previousServerVersion?: string;
  }): Promise<void> {
    await this.mutate((snapshot) => {
      const current = snapshot.drafts[options.destination];
      if (current?.id === options.draft.id) {
        snapshot.drafts[options.destination] = acknowledgeCurrentDraft(current, options.draft);
      } else if (current && options.previousServerVersion !== undefined) {
        const hasSameBase = (current.serverVersion ?? '0') === options.previousServerVersion;
        if (hasSameBase) {
          snapshot.drafts[options.destination] = {
            ...current,
            serverVersion: options.draft.serverVersion,
          };
        }
      }
      const alternatives = snapshot.draftAlternatives?.[options.destination];
      if (alternatives) {
        snapshot.draftAlternatives![options.destination] = alternatives.map((draft) => {
          return draft.id === options.draft.id
            ? acknowledgeCurrentDraft(draft, options.draft)
            : draft;
        });
      }
    });
  }

  /** Scrub every draft for revoked destinations and fence writers that captured older reply access. */
  async redactConversationReplies(destinations: string[]): Promise<void> {
    await this.mutate((snapshot) => {
      for (const destination of destinations) {
        const current = snapshot.drafts[destination];
        const alternatives = snapshot.draftAlternatives?.[destination] ?? [];
        const drafts = current ? [current, ...alternatives] : alternatives;
        const hasAccessibleReply = drafts.some(
          (draft) => draft.reply && (!draft.isReplyUnavailable || draft.reply.quote != null),
        );
        if (!hasAccessibleReply) {
          continue;
        }
        snapshot.replyRevisions ??= {};
        const revision = (snapshot.replyRevisions[destination] ?? 0) + 1;
        snapshot.replyRevisions[destination] = revision;
        if (current) {
          snapshot.drafts[destination] = protectDraftReplies({ draft: current, revision });
        }
        if (snapshot.draftAlternatives?.[destination]) {
          snapshot.draftAlternatives[destination] = alternatives.map((draft) =>
            protectDraftReplies({ draft, revision }),
          );
        }
      }
    });
  }

  /** Remove inaccessible reply excerpts from active and recovered draft revisions. */
  async redactReply(messageId: string): Promise<void> {
    await this.transformDraftReplies((draft) => redactDraftReply(draft, messageId));
  }

  /** Scrub edited reply excerpts from active and recovered drafts. */
  async scrubReplyQuote(source: { messageId: string; text: string }): Promise<void> {
    await this.transformDraftReplies((draft) => scrubDraftReplyQuote(draft, source));
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

  private async transformDraftReplies(transform: (draft: Draft) => Draft): Promise<void> {
    await this.mutate((snapshot) => {
      for (const [destination, draft] of Object.entries(snapshot.drafts)) {
        snapshot.drafts[destination] = transform(draft);
      }
      for (const [destination, alternatives] of Object.entries(snapshot.draftAlternatives ?? {})) {
        snapshot.draftAlternatives![destination] = alternatives.map(transform);
      }
    });
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
