import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';

const PASSWORD = 'a complete browser password phrase';
const DOCUMENT_BYTES = 9 * 1024 * 1024;
const DOCUMENT_NAME = 'resumable-document.bin';
const VOICE_SAMPLE_MS = 1200;

interface Account {
  username: string;
  displayName: string;
}

function account(name: string): Account {
  return { username: `media_${randomUUID().slice(0, 8)}`, displayName: name };
}

async function register(page: Page, user: Account): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill(user.username);
  await page.getByLabel('Display name', { exact: true }).fill(user.displayName);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Messages', exact: true })).toBeVisible();
}

async function openRecipient(page: Page, user: Account): Promise<void> {
  await page.getByRole('button', { name: 'Contacts & blocks', exact: true }).click();
  await page.getByRole('button', { name: 'Find people', exact: true }).click();
  await page.getByLabel('Username or display name').fill(user.username);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Message', exact: true }).click();
  await expect(page.getByRole('heading', { name: user.displayName, exact: true })).toBeVisible();
}

function latch() {
  let release: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}

test('resumes after the last tab closes without retransmitting or duplicating', async ({
  baseURL,
  browser,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'tg-chat-media-browser-'));
  let context = await chromium.launchPersistentContext(directory, { baseURL });
  const recipientContext = await browser.newContext({ baseURL });
  try {
    const sender = account('Media Sender');
    const recipient = account('Media Recipient');
    const page = context.pages()[0] ?? (await context.newPage());
    const recipientPage = await recipientContext.newPage();
    await register(page, sender);
    await register(recipientPage, recipient);
    await openRecipient(page, recipient);

    const committed = latch();
    let hasStoredFirst = false;
    await page.route('**/*', async (route) => {
      const request = route.request();
      const part = new URL(request.url()).searchParams.get('partNumber');
      if (request.method() !== 'PUT' || !part) {
        await route.continue();
        return;
      }
      if (part === '1' && !hasStoredFirst) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        hasStoredFirst = true;
        await route.abort('failed');
        committed.release();
        return;
      }
      // Prevent the next part from reaching storage before the browser closes.
      await route.abort('failed');
    });

    await page.getByLabel('Choose an attachment').setInputFiles({
      name: DOCUMENT_NAME,
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(DOCUMENT_BYTES, 31),
    });
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const bubble = page.locator('article[data-own="true"]').filter({ hasText: DOCUMENT_NAME });
    await expect(bubble).toBeVisible();
    const bubbleId = await bubble.getAttribute('id');
    await committed.ready;
    await page.close();
    await context.close();

    context = await chromium.launchPersistentContext(directory, { baseURL });
    const reopened = context.pages()[0] ?? (await context.newPage());
    const resumedParts: string[] = [];
    const mayResume = latch();
    const sendCommitted = latch();
    let hasDroppedSend = false;
    await reopened.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const part = url.searchParams.get('partNumber');
      if (request.method() === 'PUT' && part) {
        resumedParts.push(part);
        await mayResume.ready;
      }
      if (request.method() === 'POST' && url.pathname === '/api/v1/messages' && !hasDroppedSend) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        hasDroppedSend = true;
        sendCommitted.release();
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await reopened.goto('/');
    await reopened.getByRole('button', { name: 'Messages', exact: true }).click();
    const pending = reopened.getByRole('region', { name: 'Pending messages' });
    await pending.getByRole('button', { name: DOCUMENT_NAME, exact: true }).click();
    mayResume.release();
    await sendCommitted.ready;
    const recovered = reopened
      .locator('article[data-own="true"]')
      .filter({ hasText: DOCUMENT_NAME });
    await expect(recovered).toHaveCount(1);
    await expect(recovered).toHaveAttribute('id', bubbleId!);
    await expect(recovered.getByRole('img', { name: 'Stored on server' })).toBeVisible();
    expect(resumedParts).toEqual(['2']);

    await recipientPage.getByRole('button', { name: 'Messages', exact: true }).click();
    await recipientPage.getByRole('button', { name: /Media Sender/ }).click();
    const received = recipientPage
      .locator('article[data-own="false"]')
      .filter({ hasText: DOCUMENT_NAME });
    await expect(received).toHaveCount(1);
    await expect(received.getByRole('button', { name: `Download ${DOCUMENT_NAME}` })).toBeVisible();
  } finally {
    await context.close();
    await recipientContext.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('records and plays a voice message and publishes a profile avatar', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['microphone']);
  await register(page, account('Media Recorder'));
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await page.getByRole('button', { name: /Saved Messages/ }).click();
  await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
  const stop = page.getByRole('button', { name: 'Stop recording', exact: true });
  await expect(stop).toBeVisible();
  // The fake microphone must produce a nonempty audio sample before stopping.
  await page.waitForTimeout(VOICE_SAMPLE_MS);
  await stop.click();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const play = page.getByRole('button', { name: 'Play voice message', exact: true });
  await expect(play).toBeVisible();
  await play.click();
  await expect
    .poll(async () => {
      return page
        .locator('article audio')
        .evaluate((audio) => (audio as HTMLAudioElement).currentTime);
    })
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Account settings' }).click();
  await page.getByLabel('Choose avatar photo').setInputFiles('public/assets/settings-avatar.jpg');
  const profile = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Profile', exact: true }),
  });
  await expect(profile.getByRole('button', { name: 'Remove photo', exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      return profile.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth);
    })
    .toBeGreaterThan(0);
});
