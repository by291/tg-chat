import { describe, expect, it } from 'vitest';
import type { components } from '@/api/schema';
import { resumeUpload, type UploadTransport } from './uploadTransfer';

type UploadStatus = components['schemas']['UploadStatus'];

const PART_BYTES = 8 * 1024 * 1024;
const UPLOAD_ID = '00000000-0000-4000-8000-000000000001';
const FILE_ID = '00000000-0000-4000-8000-000000000002';
const EXPIRY = '2026-11-12T00:00:00Z';

describe('durable upload transfer', () => {
  it('sends only parts missing from the restored upload', async () => {
    const initial: UploadStatus = {
      upload_id: UPLOAD_ID,
      state: 'reserved',
      transfer_mode: 'multipart',
      part_size_bytes: PART_BYTES,
      expires_at: EXPIRY,
    };
    const writes: Array<{ number: number | null | undefined; bytes: number }> = [];
    const transport: UploadTransport = {
      async status() {
        return initial;
      },
      async reserve() {
        throw new Error('The reservation already exists.');
      },
      async plan() {
        return {
          single_put_complete: false,
          confirmed_parts: [1],
          requests: [
            {
              url: 'https://media.example.test/part',
              expires_at: EXPIRY,
              part_number: 2,
              headers: {},
            },
          ],
        };
      },
      async put({ request, blob }) {
        writes.push({ number: request.part_number, bytes: blob.size });
      },
      async complete() {
        return { ...initial, state: 'ready', file_id: FILE_ID };
      },
    };
    const blob = new Blob([new Uint8Array(PART_BYTES + 3)]);

    const result = await resumeUpload({
      item: {
        occurrenceId: crypto.randomUUID(),
        uploadId: UPLOAD_ID,
        filename: 'video.mp4',
        kind: 'video',
        sizeBytes: blob.size,
        sha256: 'a'.repeat(64),
        blob,
      },
      transport,
      signal: new AbortController().signal,
      checkpoint: async () => undefined,
      onProgress: () => undefined,
    });

    expect(result.file_id).toBe(FILE_ID);
    expect(writes).toEqual([{ number: 2, bytes: 3 }]);
  });
});
