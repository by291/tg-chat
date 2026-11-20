import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import type { components } from '../src/api/schema';
import { closeContexts, mutationHeaders } from './accountFixtures';
import {
  authenticate,
  CONVERGENCE_TIMEOUT_MS,
  openChat,
  visibleEverywhere,
} from './synchronizationFixtures';

test('replaces a rejected cursor from a fresh bootstrap while preserving local typing', async ({
  browser,
  baseURL,
}) => {
  const contexts: BrowserContext[] = [];
  let releaseServerState!: () => void;
  const serverStateReady = new Promise<void>((resolve) => {
    releaseServerState = resolve;
  });
  try {
    const alice = { username: `reseta_${randomUUID().slice(0, 8)}`, displayName: 'Alice Reset' };
    const bobby = { username: `resetb_${randomUUID().slice(0, 8)}`, displayName: 'Bobby Reset' };
    const grants: components['schemas']['AuthResponse'][] = [];
    for (const account of [alice, bobby]) {
      const context = await browser.newContext({ baseURL });
      contexts.push(context);
      grants.push(
        await authenticate({
          context,
          origin: baseURL!,
          account,
          isRegistration: true,
        }),
      );
    }
    const sent = await contexts[0].request.post('/api/v1/messages', {
      headers: mutationHeaders({ origin: baseURL!, grant: grants[0] }),
      data: {
        operation_id: randomUUID(),
        message_id: randomUUID(),
        destination: { kind: 'recipient', user_id: grants[1].user.id },
        content: {
          schema_version: 1,
          text: 'Before the reset',
          custom_emoji: [],
        },
      },
    });
    expect(sent.status()).toBe(200);
    const page = await contexts[0].newPage();
    await openChat(page, bobby);
    await visibleEverywhere([page], 'Before the reset');
    const editor = page.getByRole('textbox', { name: 'Message', exact: true });
    await editor.fill('Draft survives full reset');
    let rejectedCursor: string | undefined;
    let hasFreshBootstrap = false;
    let freshCursor: string | undefined;
    let hasResumedSync = false;
    await page.route('**/api/v1/chat/bootstrap', async (route) => {
      await serverStateReady;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const bootstrap = await response.json();
      freshCursor = bootstrap.cursor;
      hasFreshBootstrap = true;
      await route.fulfill({ response });
    });
    await page.route('**/api/v1/chat/sync?*', async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      expect(cursor).not.toBeNull();
      rejectedCursor ??= cursor!;
      if (hasResumedSync && cursor !== rejectedCursor) {
        await route.continue();
        return;
      }
      if (hasFreshBootstrap && cursor === freshCursor && cursor !== rejectedCursor) {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        hasResumedSync = true;
        await route.fulfill({ response });
        return;
      }
      // An expired cursor stays unusable; ordinary retry cannot repair canonical state.
      await route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'sync_reset_required',
            message: 'A fresh bootstrap is required.',
            request_id: 'browser-reset',
          },
        },
      });
    });
    const replacement = await contexts[1].request.post('/api/v1/messages', {
      headers: mutationHeaders({ origin: baseURL!, grant: grants[1] }),
      data: {
        operation_id: randomUUID(),
        message_id: randomUUID(),
        destination: { kind: 'recipient', user_id: grants[0].user.id },
        content: {
          schema_version: 1,
          text: 'Only visible after rebootstrap',
          custom_emoji: [],
        },
      },
    });
    expect(replacement.status()).toBe(200);
    releaseServerState();
    await page.bringToFront();

    await expect.poll(() => rejectedCursor, { timeout: CONVERGENCE_TIMEOUT_MS }).toBeTruthy();
    await expect.poll(() => hasFreshBootstrap, { timeout: CONVERGENCE_TIMEOUT_MS }).toBe(true);
    await expect.poll(() => hasResumedSync, { timeout: CONVERGENCE_TIMEOUT_MS }).toBe(true);
    await visibleEverywhere([page], 'Only visible after rebootstrap');
    await expect(editor).toHaveText('Draft survives full reset');
  } finally {
    releaseServerState();
    await closeContexts(contexts);
  }
});
