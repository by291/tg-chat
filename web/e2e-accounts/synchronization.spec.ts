import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { components } from '../src/api/schema';
import { closeContexts, mutationHeaders, registerAccount } from './accountFixtures';

const PASSWORD = 'a complete synchronization password phrase';
const CONVERGENCE_TIMEOUT_MS = 15_000;

interface Account {
  username: string;
  displayName: string;
}

async function authenticate(options: {
  context: BrowserContext;
  origin: string;
  account: Account;
  isRegistration: boolean;
}) {
  if (options.isRegistration) {
    return registerAccount({
      context: options.context,
      origin: options.origin,
      username: options.account.username,
      displayName: options.account.displayName,
      password: PASSWORD,
      deviceName: 'Synchronization browser',
    });
  }

  const path = 'login';
  const response = await options.context.request.post(`/api/v1/auth/${path}`, {
    headers: {
      origin: options.origin,
      'x-tg-chat-request': '1',
    },
    data: {
      username: options.account.username,
      display_name: options.isRegistration ? options.account.displayName : undefined,
      password: PASSWORD,
      device_name: 'Synchronization browser',
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function openChat(page: Page, peer: Account) {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(peer.displayName) }).click();
  await expect(page.getByRole('heading', { name: peer.displayName, exact: true })).toBeVisible();
}

async function menuAction(options: { page: Page; text: string; action: string }) {
  const row = options.page.getByRole('group', { name: `Message: ${options.text}`, exact: true });
  await row.click({ button: 'right' });
  await options.page.getByRole('menuitem', { name: options.action, exact: true }).click();
}

async function visibleEverywhere(pages: Page[], text: string) {
  for (const page of pages) {
    await expect(page.getByRole('group', { name: `Message: ${text}`, exact: true })).toBeVisible({
      timeout: CONVERGENCE_TIMEOUT_MS,
    });
  }
}

test('four sessions and a shared-cache tab converge after edits, replies, and deletion', async ({
  browser,
  baseURL,
}) => {
  const alice = { username: `synca_${randomUUID().slice(0, 8)}`, displayName: 'Alice Sync' };
  const bobby = { username: `syncb_${randomUUID().slice(0, 8)}`, displayName: 'Bobby Sync' };
  const contexts: BrowserContext[] = [];
  try {
    for (let index = 0; index < 4; index += 1) {
      contexts.push(await browser.newContext({ baseURL }));
    }
    const grants = [];
    for (let index = 0; index < contexts.length; index += 1) {
      grants.push(
        await authenticate({
          context: contexts[index],
          origin: baseURL!,
          account: index % 2 === 0 ? alice : bobby,
          isRegistration: index < 2,
        }),
      );
    }
    const headers = {
      origin: baseURL!,
      'x-tg-chat-request': '1',
      'x-csrf-token': grants[0].csrf_token,
    };
    const sent = await contexts[0].request.post('/api/v1/messages', {
      headers,
      data: {
        operation_id: randomUUID(),
        message_id: randomUUID(),
        destination: { kind: 'recipient', user_id: grants[1].user.id },
        content: {
          schema_version: 1,
          text: 'Original shared message',
          custom_emoji: [],
        },
      },
    });
    expect(sent.status()).toBe(200);
    const receipt = await sent.json();
    const pages: Page[] = [];
    for (let index = 0; index < contexts.length; index += 1) {
      const page = await contexts[index].newPage();
      await openChat(page, index % 2 === 0 ? bobby : alice);
      pages.push(page);
    }
    const sibling = await contexts[0].newPage();
    await openChat(sibling, bobby);
    pages.push(sibling);
    await visibleEverywhere(pages, 'Original shared message');

    await menuAction({
      page: pages[0],
      text: 'Original shared message',
      action: 'Edit',
    });
    await pages[0]
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Edited across devices');
    await pages[0].getByRole('button', { name: 'Save message', exact: true }).click();
    await visibleEverywhere(pages, 'Edited across devices');
    await menuAction({
      page: pages[1],
      text: 'Edited across devices',
      action: 'React 👍',
    });
    await menuAction({
      page: pages[2],
      text: 'Edited across devices',
      action: 'Pin',
    });
    for (const page of pages) {
      const row = page.getByRole('group', { name: 'Message: Edited across devices', exact: true });
      await expect(row.getByRole('button', { name: /reaction/ })).toBeVisible();
    }

    await menuAction({
      page: pages[1],
      text: 'Edited across devices',
      action: 'Reply',
    });
    await pages[1]
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('A synchronized reply');
    await pages[1].getByRole('button', { name: 'Send message', exact: true }).click();
    await visibleEverywhere(pages, 'A synchronized reply');

    const pinPreview = pages[0].getByRole('button', {
      name: 'Pinned message: Edited across devices',
      exact: true,
    });
    await expect(pinPreview).toBeVisible();
    await pinPreview.click();
    await expect(
      pages[0].getByRole('group', { name: 'Message: Edited across devices', exact: true }),
    ).toBeInViewport();

    await pages[0].bringToFront();
    await pages[0]
      .getByRole('group', { name: 'Message: A synchronized reply', exact: true })
      .scrollIntoViewIfNeeded();
    await expect
      .poll(async () => {
        const response = await contexts[1].request.get('/api/v1/chat/bootstrap');
        const bootstrap = await response.json();
        const conversation = bootstrap.conversations.find(
          (entry: { id: string }) => entry.id === receipt.conversation.id,
        );
        return conversation.peer_read_through;
      })
      .toBe('2');
    const quotedReply = pages[0].getByRole('group', {
      name: 'Message: A synchronized reply',
      exact: true,
    });
    await quotedReply.getByRole('button', { name: /Alice Sync/ }).click();
    await expect(
      pages[0].getByRole('group', { name: 'Message: Edited across devices', exact: true }),
    ).toBeInViewport();

    await menuAction({
      page: pages[2],
      text: 'Edited across devices',
      action: 'Delete',
    });
    await pages[2].getByRole('button', { name: 'Delete for everyone', exact: true }).click();
    for (const page of pages) {
      await expect(
        page.getByRole('group', { name: 'Message: Edited across devices', exact: true }),
      ).toHaveCount(0);
      const reply = page.getByRole('group', { name: 'Message: A synchronized reply', exact: true });
      await expect(reply.getByRole('button', { name: /Message unavailable/ })).toBeDisabled();
    }
    await pages[3].reload();
    await pages[3].getByRole('button', { name: /Alice Sync/ }).click();
    await expect(
      pages[3].getByRole('group', { name: 'Message: Edited across devices', exact: true }),
    ).toHaveCount(0);
    const history = await contexts[1].request.get(
      `/api/v1/conversations/${receipt.conversation.id}/history`,
    );
    const projected = (await history.json()) as components['schemas']['HistoryPage'];
    expect(projected.messages.map((message) => message.content.text)).toEqual([
      'A synchronized reply',
    ]);

    const directory = pages[0].getByRole('complementary', { name: 'Conversations' });
    await directory.getByRole('button', { name: /^Saved Messages/ }).click();
    const activeDraft = pages[0].getByRole('textbox', { name: 'Message', exact: true });
    await activeDraft.fill('Keep my draft when archiving another chat');

    const peerRow = directory.getByRole('button', { name: /^Bobby Sync/ });
    await peerRow.click({ button: 'right' });
    await pages[0].getByRole('menuitem', { name: 'Archive', exact: true }).click();
    await expect(peerRow).toHaveCount(0);
    await expect(activeDraft).toHaveText('Keep my draft when archiving another chat');

    await directory.getByRole('button', { name: 'Archived Chats', exact: true }).click();
    await expect(peerRow).toBeVisible();
    await peerRow.click({ button: 'right' });
    await pages[0].getByRole('menuitem', { name: 'Unarchive', exact: true }).click();
    await expect(peerRow).toHaveCount(0);
    await directory.getByRole('button', { name: 'Back to inbox', exact: true }).click();
    await expect(peerRow).toBeVisible();
    await expect(activeDraft).toHaveText('Keep my draft when archiving another chat');
  } finally {
    await closeContexts(contexts);
  }
});

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
        content: { schema_version: 1, text: 'Before the reset', custom_emoji: [] },
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
    await page.route('**/api/v1/chat/bootstrap', async (route) => {
      await serverStateReady;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      hasFreshBootstrap = true;
      await route.fulfill({ response });
    });
    await page.route('**/api/v1/chat/sync?*', async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      expect(cursor).not.toBeNull();
      rejectedCursor ??= cursor!;
      if (hasFreshBootstrap && cursor !== rejectedCursor) {
        await route.continue();
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
        content: { schema_version: 1, text: 'Only visible after rebootstrap', custom_emoji: [] },
      },
    });
    expect(replacement.status()).toBe(200);
    releaseServerState();
    await page.bringToFront();

    await expect.poll(() => rejectedCursor, { timeout: CONVERGENCE_TIMEOUT_MS }).toBeTruthy();
    await expect.poll(() => hasFreshBootstrap, { timeout: CONVERGENCE_TIMEOUT_MS }).toBe(true);
    await visibleEverywhere([page], 'Only visible after rebootstrap');
    await expect(editor).toHaveText('Draft survives full reset');
  } finally {
    releaseServerState();
    await closeContexts(contexts);
  }
});
