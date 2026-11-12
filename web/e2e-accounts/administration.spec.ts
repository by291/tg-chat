import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { components } from '../src/api/schema';

const PASSWORD = 'a complete administration browser password phrase';
const DEVICE_NAME = 'Administration acceptance browser';
const CONVERGENCE_TIMEOUT_MS = 15_000;
const ORIGINAL_NAME = 'reported-original.txt';
const ORIGINAL_BYTES = Buffer.from('The case retains this exact original.\n');
const SHARED_MESSAGE = 'Shared history survives conversation quarantine.';

type AuthResponse = components['schemas']['AuthResponse'];

interface Account {
  context: BrowserContext;
  page: Page;
  origin: string;
  grant: AuthResponse;
}

interface Credentials {
  username: string;
  password: string;
}

interface AdmissionOptions {
  context: BrowserContext;
  origin: string;
  credentials: Credentials;
  displayName?: string;
}

function mutationHeaders(origin: string, csrfToken?: string) {
  const marker = { origin, 'x-tg-chat-request': '1' };
  if (csrfToken) {
    return { ...marker, 'x-csrf-token': csrfToken };
  }

  return marker;
}

async function admitAccount(options: AdmissionOptions): Promise<Account> {
  const { context, origin, credentials, displayName } = options;
  const isRegistering = displayName !== undefined;
  const endpoint = isRegistering ? 'register' : 'login';
  const response = await context.request.post(`/api/v1/auth/${endpoint}`, {
    headers: mutationHeaders(origin),
    data: {
      ...credentials,
      device_name: DEVICE_NAME,
      ...(isRegistering ? { display_name: displayName } : {}),
    },
  });
  expect(response.status()).toBe(isRegistering ? 201 : 200);

  return {
    context,
    origin,
    page: await context.newPage(),
    grant: await response.json(),
  };
}

async function register(context: BrowserContext, origin: string, displayName: string) {
  return admitAccount({
    context,
    origin,
    displayName,
    credentials: {
      username: `m8_${randomUUID().slice(0, 8)}`,
      password: PASSWORD,
    },
  });
}

function operatorCredentials(): Credentials {
  const username = process.env.TG_CHAT_TEST_OPERATOR_USERNAME;
  const password = process.env.TG_CHAT_TEST_OPERATOR_PASSWORD;
  if (!username || !password) {
    throw new Error('The lifecycle fixture must provide the bootstrapped operator credentials.');
  }

  return { username, password };
}

async function seedDirectHistory(author: Account, recipient: Account) {
  const message: components['schemas']['SendMessage'] = {
    operation_id: randomUUID(),
    message_id: randomUUID(),
    destination: { kind: 'recipient', user_id: recipient.grant.user.id },
    content: {
      schema_version: 1,
      text: SHARED_MESSAGE,
      custom_emoji: [],
    },
  };
  const response = await author.context.request.post('/api/v1/messages', {
    headers: mutationHeaders(author.origin, author.grant.csrf_token),
    data: message,
  });
  expect(response.status()).toBe(200);
}

function conversationButton(page: Page, title: string) {
  const directory = page.getByRole('complementary', { name: 'Conversations' });
  return directory.getByRole('button', { name: new RegExp(`^${title}`) });
}

function sharedMessage(page: Page) {
  return page.getByRole('group', { name: `Message: ${SHARED_MESSAGE}`, exact: true });
}

async function openDirectHistory(page: Page, title: string) {
  await conversationButton(page, title).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(sharedMessage(page)).toBeVisible();
}

async function openMessages(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
}

function originalMessage(page: Page) {
  return page.locator('[data-message-id]').filter({ hasText: ORIGINAL_NAME });
}

async function sendOriginal(page: Page) {
  await page.getByLabel('Choose an attachment').setInputFiles({
    name: ORIGINAL_NAME,
    mimeType: 'text/plain',
    buffer: ORIGINAL_BYTES,
  });
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(originalMessage(page).getByRole('img', { name: 'Stored on server' })).toBeVisible();
}

async function reportOriginal(page: Page, note: string) {
  await originalMessage(page).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Report', exact: true }).click();
  const report = page.getByRole('dialog', { name: 'Report message', exact: true });
  await report.getByLabel('Report reason', { exact: true }).selectOption('other');
  await report.getByLabel('Note (optional)', { exact: true }).fill(note);
  await report.getByRole('button', { name: 'Submit report', exact: true }).click();
  const submitted = page.getByRole('dialog', { name: 'Report submitted', exact: true });
  await submitted.getByRole('button', { name: 'Done', exact: true }).click();
}

async function deleteOriginal(page: Page) {
  await originalMessage(page).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const remove = page.getByRole('dialog', { name: 'Remove message?', exact: true });
  await remove.getByRole('button', { name: 'Delete for everyone', exact: true }).click();
  await expect(originalMessage(page)).toHaveCount(0);
}

async function confirmPassword(page: Page, password: string) {
  await page.getByLabel('Password confirmation', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Confirm password', exact: true }).click();
  await expect(
    page.getByText('Password confirmed. You can retry your sensitive change.'),
  ).toBeVisible();
}

async function downloadOriginal(page: Page, note: string) {
  await page.getByRole('button', { name: 'Load reports', exact: true }).click();
  const cases = page.getByRole('button', { name: 'Review other report', exact: true });
  await cases.first().click();
  const evidence = page.getByRole('region', { name: 'Case evidence', exact: true });
  await expect(evidence.getByText(`Report note: ${note}`, { exact: true })).toBeVisible();

  const pendingDownload = page.waitForEvent('download');
  await evidence.getByRole('link', { name: `Download ${ORIGINAL_NAME}`, exact: true }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe(ORIGINAL_NAME);
  const path = await download.path();
  if (!path) {
    throw new Error('The browser did not save the original attachment.');
  }

  expect(await readFile(path)).toEqual(ORIGINAL_BYTES);
}

function waitForPost(page: Page, path: string) {
  return page.waitForResponse((response) => {
    const isPost = response.request().method() === 'POST';
    return isPost && new URL(response.url()).pathname === path;
  });
}

async function changeQuarantine(page: Page, state: 'quarantine' | 'restore') {
  const evidence = page.getByRole('region', { name: 'Case evidence', exact: true });
  const buttonName = 'Change conversation quarantine';
  const submit = page.getByRole('button', { name: buttonName, exact: true });
  const form = evidence.locator('form').filter({ has: submit });
  await form.getByLabel('Conversation action').selectOption(state);
  await form.getByLabel('Reason', { exact: true }).fill(`Browser acceptance: ${state}`);
  const committed = waitForPost(page, '/api/v1/operator/commands');
  await form.getByRole('button', { name: buttonName, exact: true }).click();
  expect((await committed).status()).toBe(204);
}

test('retained report originals and quarantine work across connected browsers', async ({
  baseURL,
  browser,
  context,
}) => {
  const origin = new URL(baseURL!).origin;
  const recipientContext = await browser.newContext({ baseURL });
  const operatorContext = await browser.newContext({ baseURL });
  try {
    const author = await register(context, origin, 'Evidence Author');
    const recipient = await register(recipientContext, origin, 'Evidence Reporter');
    await seedDirectHistory(author, recipient);
    await Promise.all([openMessages(author.page), openMessages(recipient.page)]);
    await Promise.all([
      openDirectHistory(author.page, 'Evidence Reporter'),
      openDirectHistory(recipient.page, 'Evidence Author'),
    ]);
    await author.page.bringToFront();
    await sendOriginal(author.page);
    await recipient.page.bringToFront();
    const note = `Original evidence ${randomUUID()}`;
    await reportOriginal(recipient.page, note);
    await author.page.bringToFront();
    await deleteOriginal(author.page);
    await expect(originalMessage(recipient.page)).toHaveCount(0, {
      timeout: CONVERGENCE_TIMEOUT_MS,
    });

    const credentials = operatorCredentials();
    const operator = await admitAccount({ context: operatorContext, origin, credentials });
    await operator.page.goto('/');
    await operator.page.getByRole('button', { name: 'Account settings' }).click();
    await operator.page.getByRole('button', { name: 'Administration', exact: true }).click();
    await confirmPassword(operator.page, credentials.password);
    await downloadOriginal(operator.page, note);
    await changeQuarantine(operator.page, 'quarantine');

    await expect(sharedMessage(author.page)).toHaveCount(0, { timeout: CONVERGENCE_TIMEOUT_MS });
    await expect(sharedMessage(recipient.page)).toHaveCount(0, { timeout: CONVERGENCE_TIMEOUT_MS });
    await expect(conversationButton(author.page, 'Evidence Reporter')).toHaveCount(0);
    await expect(conversationButton(recipient.page, 'Evidence Author')).toHaveCount(0);

    await changeQuarantine(operator.page, 'restore');
    await Promise.all([
      expect(conversationButton(author.page, 'Evidence Reporter')).toBeVisible({
        timeout: CONVERGENCE_TIMEOUT_MS,
      }),
      expect(conversationButton(recipient.page, 'Evidence Author')).toBeVisible({
        timeout: CONVERGENCE_TIMEOUT_MS,
      }),
    ]);
    await Promise.all([
      openDirectHistory(author.page, 'Evidence Reporter'),
      openDirectHistory(recipient.page, 'Evidence Author'),
    ]);
  } finally {
    await Promise.all([recipientContext.close(), operatorContext.close()]);
  }
});

async function createOwnedCommunity(page: Page, title: string) {
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Group', exact: true }).click();
  await page.getByLabel('Community title', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  const chat = page.getByRole('region', { name: 'Chat', exact: true });
  await expect(chat.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

async function deleteOwnedCommunity(page: Page, title: string) {
  const directory = page.getByRole('complementary', { name: 'Conversations' });
  await directory.getByRole('button', { name: new RegExp(`^${title}`) }).click();
  await page.getByRole('button', { name: `View ${title} profile`, exact: true }).click();
  await page.getByRole('button', { name: 'Delete community', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete community for everyone?', exact: true });
  const committed = waitForPost(page, '/api/v1/communities/commands');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  expect((await committed).status()).toBe(200);
  await expect(page.getByRole('dialog', { name: 'Group info' })).toHaveCount(0);
}

async function requestDeletion(page: Page, expectedStatus: number) {
  await page.getByRole('button', { name: 'Account settings' }).click();
  await page.getByRole('button', { name: 'Privacy and Security' }).click();
  await page.getByRole('button', { name: 'Password & recovery', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to deletion', exact: true }).click();
  await page.getByLabel('I understand that shared messages will remain.').check();
  const completed = waitForPost(page, '/api/v1/account/deletion');
  await page.getByRole('button', { name: 'Permanently delete account', exact: true }).click();
  expect((await completed).status()).toBe(expectedStatus);
}

test('account deletion presents owned communities before revoking both browser sessions', async ({
  baseURL,
  browser,
  context,
}) => {
  const origin = new URL(baseURL!).origin;
  const oldContext = await browser.newContext({ baseURL });
  try {
    const account = await register(context, origin, 'Community Owner');
    await admitAccount({
      context: oldContext,
      origin,
      credentials: { username: account.grant.user.username, password: PASSWORD },
    });
    await account.page.goto('/');
    const title = `Owned group ${randomUUID().slice(0, 8)}`;
    await createOwnedCommunity(account.page, title);

    await requestDeletion(account.page, 409);
    const settings = account.page.getByRole('complementary', { name: 'Account pages' });
    await expect(settings.getByText('Transfer or delete these communities first.')).toBeVisible();
    await expect(settings.getByText(title, { exact: true })).toBeVisible();
    expect((await oldContext.request.get('/api/v1/auth/session')).status()).toBe(200);

    await account.page.getByRole('button', { name: 'Back to privacy and security' }).click();
    await account.page.getByRole('button', { name: 'Back to settings' }).click();
    await account.page.getByRole('button', { name: 'Back to chats', exact: true }).click();
    await deleteOwnedCommunity(account.page, title);
    await requestDeletion(account.page, 200);
    await expect(account.page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    expect((await oldContext.request.get('/api/v1/auth/session')).status()).toBe(401);
    expect((await context.request.get('/api/v1/auth/session')).status()).toBe(401);
  } finally {
    await oldContext.close();
  }
});
