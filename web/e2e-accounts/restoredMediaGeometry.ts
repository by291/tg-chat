import { expect, type Page } from '@playwright/test';
import type { PendingMessage, PendingSnapshot } from '../src/features/chat/data/pendingMessages';

const SERVER_PROCESSING_TIMEOUT_MS = 30_000;
const PORTRAIT = {
  filename: 'portrait.png',
  width: 600,
  height: 1200,
};
const WIDE = {
  filename: 'wide.png',
  width: 1600,
  height: 800,
};
const NARROW = {
  filename: 'narrow.png',
  width: 200,
  height: 600,
};
const FILE_GROUPS = [[PORTRAIT], [WIDE, NARROW]];

interface MediaFrame {
  width: number;
  height: number;
}

/** Seed a previous client's measured sources in this isolated account for a real reload and upload. */
export async function seedRestoredMedia(page: Page) {
  const bootstrap = await page.request.get('/api/v1/chat/bootstrap');
  const session = await page.request.get('/api/v1/auth/session');
  expect(bootstrap.ok()).toBe(true);
  expect(session.ok()).toBe(true);
  const account = await bootstrap.json();
  const auth = await session.json();
  const key = `tg-chat:pending:v1:${account.deployment_id}:${auth.user.id}:${auth.session.id}`;

  await page.evaluate(
    async ({ groups, key }) => {
      async function createUpload(source: typeof PORTRAIT) {
        const canvas = document.createElement('canvas');
        canvas.width = source.width;
        canvas.height = source.height;
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((image) => {
            if (image) {
              resolve(image);
            } else {
              reject(new Error('The browser could not encode the PNG fixture.'));
            }
          });
        });
        return {
          ...source,
          kind: 'image' as const,
          occurrenceId: crypto.randomUUID(),
          uploadId: crypto.randomUUID(),
          sizeBytes: blob.size,
          blob,
        };
      }

      const pending: PendingMessage[] = [];
      for (const group of groups) {
        const media = await Promise.all(group.map(createUpload));
        pending.push({
          createdAt: Date.now(),
          status: 'queued',
          isPrepared: false,
          title: 'Saved Messages',
          media,
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
        });
      }

      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const opened = indexedDB.open('keyval-store');
        opened.onsuccess = () => resolve(opened.result);
        opened.onerror = () => reject(opened.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction('keyval', 'readwrite');
          const store = transaction.objectStore('keyval');
          const read = store.get(key);
          // Keep the private snapshot intact and publish complete blobs in the same transaction.
          read.onsuccess = () => {
            const snapshot: PendingSnapshot = read.result;
            store.put({ ...snapshot, pending: [...snapshot.pending, ...pending] }, key);
          };
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
    },
    { groups: FILE_GROUPS, key },
  );
}

/** Measure the actual rendered rectangles at each stage of durable upload reconciliation. */
export async function measureMediaFrames(page: Page, stage: 'pending' | 'accepted') {
  const frames: MediaFrame[] = [];
  for (const file of FILE_GROUPS.flat()) {
    const tile =
      stage === 'pending'
        ? page.getByRole('group', { name: file.filename, exact: true })
        : page.getByRole('button', { name: new RegExp(`Open.*${file.filename}`) });
    await expect(tile).toBeVisible({ timeout: SERVER_PROCESSING_TIMEOUT_MS });
    const bounds = await tile.boundingBox();
    if (!bounds) {
      throw new Error(`No visible media frame for ${file.filename}`);
    }
    frames.push({ width: bounds.width, height: bounds.height });
  }
  return frames;
}
