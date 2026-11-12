import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { components } from '../src/api/schema';

const PASSWORD = 'a complete read time browser password phrase';
const MESSAGE = 'Read this on the other device';

interface ReadTimeAccount {
  context: BrowserContext;
  displayName: string;
  headers: Record<string, string>;
  userId: string;
}

async function register(options: {
  context: BrowserContext;
  origin: string;
  displayName: string;
}): Promise<ReadTimeAccount> {
  const { context, origin, displayName } = options;
  const response = await context.request.post('/api/v1/auth/register', {
    headers: { origin, 'x-tg-chat-request': '1' },
    data: {
      username: `readtime_${randomUUID().slice(0, 8)}`,
      display_name: displayName,
      password: PASSWORD,
      device_name: 'Read time browser',
    },
  });
  expect(response.ok()).toBe(true);
  const account = (await response.json()) as components['schemas']['AuthResponse'];

  return {
    context,
    displayName,
    userId: account.user.id,
    headers: { origin, 'x-tg-chat-request': '1', 'x-csrf-token': account.csrf_token },
  };
}

async function setPresence(account: ReadTimeAccount, presence: 'everyone' | 'nobody') {
  const response = await account.context.request.patch('/api/v1/account/privacy', {
    headers: account.headers,
    data: { direct_messages: 'everyone', calls: 'contacts', presence },
  });
  expect(response.ok()).toBe(true);
}

async function openChat(page: Page, account: ReadTimeAccount) {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(`^${account.displayName}`) }).click();
  await expect(page.getByRole('heading', { name: account.displayName, exact: true })).toBeVisible();
}

test('outgoing message menu shows the peer read time while their activity is shared', async ({
  page,
  browser,
  baseURL,
}) => {
  const peerContext = await browser.newContext({ baseURL });
  try {
    const sender = await register({
      context: page.context(),
      origin: baseURL!,
      displayName: 'Read Time Sender',
    });
    const recipient = await register({
      context: peerContext,
      origin: baseURL!,
      displayName: 'Read Time Recipient',
    });
    await setPresence(recipient, 'everyone');
    const messageId = randomUUID();
    const sent = await sender.context.request.post('/api/v1/messages', {
      headers: sender.headers,
      data: {
        operation_id: randomUUID(),
        message_id: messageId,
        destination: { kind: 'recipient', user_id: recipient.userId },
        content: { schema_version: 1, text: MESSAGE, custom_emoji: [] },
      },
    });
    expect(sent.ok()).toBe(true);
    const readTimePath = `/api/v1/messages/${messageId}/read-time`;
    const unread = await sender.context.request.get(readTimePath, { headers: sender.headers });
    expect(await unread.json()).toEqual({ read_at: null });

    await openChat(page, recipient);
    const peerPage = await peerContext.newPage();
    await peerPage.bringToFront();
    await openChat(peerPage, sender);
    await expect(peerPage.getByRole('group', { name: `Message: ${MESSAGE}` })).toBeInViewport();
    await expect
      .poll(async () => {
        const response = await sender.context.request.get(readTimePath);
        const receipt = (await response.json()) as components['schemas']['MessageReadTime'];
        return receipt.read_at;
      })
      .toBeTruthy();

    await page.bringToFront();
    const outgoing = page.getByRole('group', { name: `Message: ${MESSAGE}` });
    await expect(outgoing.getByRole('img', { name: 'Read', exact: true })).toBeVisible();
    await outgoing.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Message actions' });
    const timestamp = menu.getByText(/^Read /);
    await expect(timestamp).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    const incoming = await recipient.context.request.get(readTimePath, {
      headers: recipient.headers,
    });
    expect(incoming.status()).toBe(404);

    await setPresence(recipient, 'nobody');
    const denied = page.waitForResponse((response) => response.url().endsWith(readTimePath));
    await outgoing.click({ button: 'right' });
    expect((await denied).status()).toBe(404);
    await expect(timestamp).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Reply' })).toBeVisible();
  } finally {
    await peerContext.close();
  }
});
