import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import type { components } from '@/api/schema';
import { pendingMedia, type UploadTransport } from '@/features/media/uploadTransfer';
import { ChatMediaQueue } from './ChatMediaQueue';
import { PendingMessages, type PendingMessage } from './pendingMessages';

it('keeps processing visible after the queue saves its recovery checkpoint', async () => {
  const sessionId = crypto.randomUUID();
  const store = new PendingMessages({ key: sessionId });
  await store.open();

  const source = pendingMedia({
    filename: 'clip.mp4',
    kind: 'video',
    blob: new Blob(['video']),
  });
  const message: PendingMessage = {
    createdAt: Date.now(),
    status: 'queued',
    media: [source],
    request: {
      operation_id: crypto.randomUUID(),
      message_id: crypto.randomUUID(),
      destination: { kind: 'saved' },
      content: {
        schema_version: 1,
        text: '',
        custom_emoji: [],
      },
    },
  };
  await store.enqueue({ message });

  const processingStatus: components['schemas']['UploadStatus'] = {
    upload_id: source.uploadId,
    expires_at: new Date().toISOString(),
    state: 'processing',
    transfer_mode: 'single_put',
  };
  const unexpectedTransfer = async () => {
    throw new Error('The existing upload is already processing.');
  };
  const transport: UploadTransport = {
    status: async () => processingStatus,
    reserve: unexpectedTransfer,
    plan: unexpectedTransfer,
    put: unexpectedTransfer,
    complete: unexpectedTransfer,
  };

  let hasProcessingUpdate = false;
  let checkpointUpdate: PendingMessage | undefined;
  const queue = new ChatMediaQueue({
    sessionId,
    store,
    transport,
    onReady: () => undefined,
    onPending: (pending) => {
      if (hasProcessingUpdate) {
        checkpointUpdate = pending;
        queue.close();
        return;
      }
      hasProcessingUpdate = pending.mediaProgress?.phase === 'processing';
    },
  });

  await queue.kick([message]);

  expect(checkpointUpdate?.mediaProgress).toEqual({
    phase: 'processing',
    bytes: source.sizeBytes,
    occurrenceId: source.occurrenceId,
    occurrenceBytes: source.sizeBytes,
  });
  const restored = await store.read();
  expect(restored.pending[0].mediaProgress).toBeUndefined();
});
