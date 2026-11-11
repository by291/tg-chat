import { ApiError, isCancelled } from '@/features/auth/SessionOwner';
import {
  resumeUpload,
  type PendingMedia,
  type UploadProgress,
  type UploadTransport,
} from '@/features/media/uploadTransfer';
import type { PendingMessage, PendingMessages } from './pendingMessages';

const TRANSIENT_FAILURES = new Set([
  'account_changed',
  'dependency_unavailable',
  'network_unavailable',
  'rate_limited',
]);

interface QueueOptions {
  store: PendingMessages;
  transport: UploadTransport;
  onPending: (message: PendingMessage) => void;
  onReady: () => void;
}

interface ActiveTransfer {
  messageId: string;
  token: string;
  controller: AbortController;
}

function isWaiting(message: PendingMessage): boolean {
  return Boolean(
    message.media?.length && !message.request.attachments?.length && message.status !== 'failed',
  );
}

export class ChatMediaQueue {
  private readonly options: QueueOptions;
  private running?: Promise<void>;
  private active?: ActiveTransfer;
  private isClosed = false;

  /** Own attachment preparation independently of the text send loop. */
  constructor(options: QueueOptions) {
    this.options = options;
  }

  /** Start waiting media without delaying text sends or conversation catch-up. */
  kick(pending: PendingMessage[]): Promise<void> {
    if (this.isClosed || !pending.some(isWaiting)) {
      return Promise.resolve();
    }
    this.running ??= this.preparePending(pending).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /** Abort local transport for an item removed from the durable queue. */
  cancel(messageId: string): void {
    if (this.active?.messageId === messageId) {
      this.active.controller.abort();
    }
  }

  /** Stop this document's transports so another tab can recover the durable state. */
  close(): void {
    this.isClosed = true;
    this.active?.controller.abort();
  }

  private async preparePending(pending: PendingMessage[]): Promise<void> {
    for (const message of pending) {
      if (this.isClosed || !isWaiting(message)) {
        continue;
      }
      const messageId = message.request.message_id;
      if (navigator.locks) {
        const key = `tg-chat:media:${messageId}`;
        await navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
          if (lock) {
            await this.prepare(messageId, { hasBrowserLock: true });
          }
        });
      } else {
        await this.prepare(messageId, { hasBrowserLock: false });
      }
    }
  }

  private async prepare(messageId: string, options: { hasBrowserLock: boolean }): Promise<void> {
    if (this.isClosed) {
      return;
    }
    const store = this.options.store;
    const claim = await store.claimMedia({ messageId, ...options });
    if (!claim) {
      return;
    }
    const active = { messageId, token: claim.token, controller: new AbortController() };
    this.active = active;
    try {
      const pending = await store.read();
      const message = pending.pending.find((entry) => entry.request.message_id === messageId);
      if (!message?.media || this.isClosed) {
        return;
      }
      await this.prepareItems({ active, message });
      if (!this.isClosed) {
        this.options.onReady();
      }
    } catch (error) {
      if (!this.isClosed && !isCancelled(error)) {
        await this.recordFailure({ messageId, error });
      }
    } finally {
      this.active = undefined;
      await store.releaseMedia({ messageId, token: claim.token });
    }
  }

  private async prepareItems(input: {
    active: ActiveTransfer;
    message: PendingMessage;
  }): Promise<void> {
    const { active, message } = input;
    let completedBytes = 0;
    let current = message;
    for (const original of message.media ?? []) {
      if (original.fileId) {
        completedBytes += original.sizeBytes;
        continue;
      }
      let item = original;
      const save = async (next: PendingMedia) => {
        const checkpoint = await this.options.store.checkpointMedia({
          messageId: active.messageId,
          token: active.token,
          item: next,
        });
        if (!checkpoint || this.isClosed) {
          throw new DOMException('Upload ownership ended.', 'AbortError');
        }
        item = next;
        current = checkpoint;
        this.options.onPending(checkpoint);
      };
      const report = (progress: UploadProgress) => {
        if (this.isClosed || active.controller.signal.aborted) {
          return;
        }
        this.options.onPending({
          ...current,
          mediaProgress: { phase: progress.phase, bytes: completedBytes + progress.bytes },
        });
      };
      const status = await resumeUpload({
        item,
        transport: this.options.transport,
        signal: active.controller.signal,
        checkpoint: save,
        onProgress: report,
      });
      await save({ ...item, fileId: status.file_id ?? undefined });
      completedBytes += item.sizeBytes;
    }
  }

  private async recordFailure(input: { messageId: string; error: unknown }): Promise<void> {
    const snapshot = await this.options.store.read();
    const current = snapshot.pending.find((entry) => entry.request.message_id === input.messageId);
    if (!current || current.mediaClaim?.token !== this.active?.token) {
      return;
    }
    const isRetryable = input.error instanceof ApiError && TRANSIENT_FAILURES.has(input.error.code);
    const error =
      input.error instanceof Error ? input.error.message : 'The upload could not finish.';
    const next = await this.options.store.updatePending(
      { ...current, status: isRetryable ? 'queued' : 'failed', error },
      { mediaToken: this.active?.token },
    );
    if (next) {
      this.options.onPending(next);
    }
  }
}
