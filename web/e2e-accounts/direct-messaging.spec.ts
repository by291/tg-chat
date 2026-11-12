import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'a complete browser password phrase';
const HISTORY_MESSAGES = 55;

interface Account {
  username: string;
  displayName: string;
}

async function register(page: Page, account: Account) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill(account.username);
  await page.getByLabel('Display name', { exact: true }).fill(account.displayName);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
}

async function openRecipient(page: Page, account: Account) {
  await page.getByRole('button', { name: 'Contacts', exact: true }).click();
  await page.getByRole('button', { name: 'Add contact', exact: true }).click();
  await page.getByLabel('Username or display name').fill(account.username);
  await page.getByRole('button', { name: 'Message', exact: true }).click();
  await expect(page.getByRole('heading', { name: account.displayName, exact: true })).toBeVisible();
}

test('two accounts exchange rich messages, recover pending sends, page history, and keep Saved private', async ({
  browser,
  page,
  baseURL,
}, testInfo) => {
  const alice = { username: `alice_${randomUUID().slice(0, 8)}`, displayName: 'Alice Messaging' };
  const bobby = { username: `bobby_${randomUUID().slice(0, 8)}`, displayName: 'Bobby Messaging' };
  const peerContext = await browser.newContext({ baseURL });
  const peer = await peerContext.newPage();
  try {
    await register(page, alice);
    await register(peer, bobby);
    await openRecipient(page, bobby);
    const editor = page.getByRole('textbox', { name: 'Message', exact: true });
    await editor.fill('A durable bold greeting 😀');
    await page.getByRole('button', { name: 'Account settings', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
    await expect(editor).toBeVisible();
    await expect(editor).toHaveText('A durable bold greeting 😀');
    await page.screenshot({ path: testInfo.outputPath('account-settings-desktop.png') });
    await page.getByRole('button', { name: 'Back to settings' }).click();
    await page.getByRole('button', { name: 'Back to chats' }).click();
    await editor.press('ControlOrMeta+a');
    await editor.press('ControlOrMeta+b');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Stored on server' })).toBeVisible();
    const outgoing = page.locator('article[data-own="true"]');
    await expect(outgoing).toHaveCount(1);
    await expect(outgoing.locator('strong')).toContainText('durable bold greeting');
    await expect(page.getByLabel('Choose an attachment')).toHaveCount(0);

    await peer.getByRole('button', { name: /Alice Messaging/ }).click();
    await expect(peer.locator('article[data-own="false"]')).toContainText('durable bold greeting');
    await page.screenshot({ path: testInfo.outputPath('connected-desktop.png'), fullPage: true });

    // Keep the app reachable while only message submission is unavailable across a full reload.
    await page.route('**/api/v1/messages', (route) => route.abort('failed'));
    await editor.fill('Recovered from the persistent outbox');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Pending messages' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Pending messages' })).toContainText(
      'persistent outbox',
    );
    await page.unroute('**/api/v1/messages');
    await expect(page.getByRole('region', { name: 'Pending messages' })).toHaveCount(0);
    await page.getByRole('button', { name: /Bobby Messaging/ }).click();
    await expect(page.locator('[data-message-id]')).toContainText([
      'durable bold greeting',
      'persistent outbox',
    ]);

    const grant = await (await page.request.get('/api/v1/auth/session')).json();
    const bootstrap = await (await page.request.get('/api/v1/chat/bootstrap')).json();
    const conversation = bootstrap.conversations.find(
      (entry: { kind: string }) => entry.kind === 'direct',
    );
    for (let index = 0; index < HISTORY_MESSAGES; index += 1) {
      const response = await page.request.post('/api/v1/messages', {
        headers: {
          origin: baseURL!,
          'x-tg-chat-request': '1',
          'x-csrf-token': grant.csrf_token,
        },
        data: {
          operation_id: randomUUID(),
          message_id: randomUUID(),
          destination: { kind: 'conversation', conversation_id: conversation.id },
          content: {
            schema_version: 1,
            text: `History entry ${index}`,
            rich_text: null,
            custom_emoji: [],
          },
        },
      });
      expect(response.status()).toBe(200);
    }
    await page.getByRole('button', { name: 'Latest messages', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Load older messages' })).toBeVisible();
    await page.getByRole('button', { name: 'Load older messages' }).click();
    const history = await page.request.get(
      `/api/v1/conversations/${conversation.id}/history?limit=100`,
    );
    expect((await history.json()).messages).toHaveLength(HISTORY_MESSAGES + 2);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Back to conversations' }).click();
    await page.getByRole('button', { name: 'Account settings', exact: true }).click();
    await page.getByRole('button', { name: 'Privacy and Security', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Privacy and Security' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Calls / })).toBeVisible();
    await expect(editor).not.toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('account-settings-mobile.png') });
    await page.getByRole('button', { name: 'Back to settings' }).click();
    await page.getByRole('button', { name: 'Back to chats' }).click();
    await page.getByRole('button', { name: /Saved Messages/ }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Private saved note');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Stored on server' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Message: Private saved note' })).toBeInViewport({
      ratio: 1,
    });
    await page.screenshot({ path: testInfo.outputPath('connected-mobile.png'), fullPage: true });
    const saved = bootstrap.conversations.find((entry: { kind: string }) => entry.kind === 'saved');
    const forbidden = await peer.request.get(`/api/v1/conversations/${saved.id}/history`);
    expect(forbidden.status()).toBe(404);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  } finally {
    await peerContext.close();
  }
});
