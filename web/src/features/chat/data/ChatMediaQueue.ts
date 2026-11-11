import { ApiError, isCancelled } from '@/features/auth/SessionOwner';
import { withMediaSession } from '@/features/media/mediaSessionLock';
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
  sessionId: string;
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
    this.running ??= this.runSession(pending).finally(() => {
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

  private async runSession(pending: PendingMessage[]): Promise<void> {
    await withMediaSession({
      sessionId: this.options.sessionId,
      run: async (options) => {
        for (const message of pending) {
          if (!this.isClosed && isWaiting(message)) {
            await this.prepare(message.request.message_id, options);
          }
        }
      },
    });
  }

  private async prepare(messageId: string, options: { hasBrowserLock: boolean }): Promise<void> {
    if (this.isClosed) {
      return;
    }
    const store = this.options.store;
    const claim = await store.claimMedia({ messageId, ...options });
    if (!claim) {
      // Another tab may have checkpointed the final file before closing or losing its response.
      const snapshot = await store.read();
      const current = snapshot.pending.find((entry) => entry.request.message_id === messageId);
      if (!this.isClosed && current?.request.attachments?.length) {
        this.options.onPending(current);
        this.options.onReady();
      }
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
        const persisted = checkpoint.media?.find(
          (entry) => entry.occurrenceId === next.occurrenceId,
        );
        if (!persisted) {
          throw new DOMException('Upload ownership ended.', 'AbortError');
        }
        if (next.blob && !persisted.blob && !next.fileId) {
          throw new ApiError({
            code: 'media_source_missing',
            message: 'Select the original file to continue this upload.',
          });
        }
        item = persisted;
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
