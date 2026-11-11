import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import type { components } from '../src/api/schema';

const PASSWORD = 'a complete notifications browser password phrase';
const DEVICE_NAME = 'Notifications acceptance browser';
const SENDER = 'Activity Sender';
const RECIPIENT = 'Activity Recipient';
const BACKFILL_MESSAGE = 'Messages restored from history stay silent.';
const LIVE_MESSAGE = 'New messages outside the active chat can alert.';
const ACTIVE_MESSAGE = 'Reading this conversation suppresses a repeated alert.';
const CONVERGENCE_TIMEOUT_MS = 15_000;
const WORKER_SCRIPT_PATH = '/notification-worker.js';
const NOTIFICATION_LOCK = 'tg-chat:browser-push';
const LIVE_ALERT = 'New message';

type AuthResponse = components['schemas']['AuthResponse'];

interface AuthenticatedBrowser {
  context: BrowserContext;
  origin: string;
  grant: AuthResponse;
}

interface Admission {
  context: BrowserContext;
  origin: string;
  username: string;
  displayName?: string;
}

interface JsonMutation {
  path: string;
  body: object;
  method?: 'POST' | 'PATCH';
}

interface SyntheticPush {
  identity: {
    deployment_id: string;
    message_id: string;
    subscription_id: string;
  };
  conversation_id: string;
}

interface WorkerObservation {
  received: number;
  displayed: { title: string; options?: NotificationOptions }[];
}

type ObservedWorker = ServiceWorkerGlobalScope & { observation: WorkerObservation };

function headers(origin: string, csrf?: string) {
  const originHeaders = { origin, 'x-tg-chat-request': '1' };
  return csrf ? { ...originHeaders, 'x-csrf-token': csrf } : originHeaders;
}

async function admit(input: Admission): Promise<AuthenticatedBrowser> {
  const { context, origin, username, displayName } = input;
  const endpoint = displayName ? 'register' : 'login';
  const response = await context.request.post(`/api/v1/auth/${endpoint}`, {
    headers: headers(origin),
    data: {
      username,
      password: PASSWORD,
      device_name: DEVICE_NAME,
      ...(displayName ? { display_name: displayName } : {}),
    },
  });
  expect(response.status()).toBe(displayName ? 201 : 200);

  return {
    context,
    origin,
    grant: await response.json(),
  };
}

async function mutate(browser: AuthenticatedBrowser, request: JsonMutation) {
  return browser.context.request.fetch(request.path, {
    method: request.method ?? 'POST',
    headers: headers(browser.origin, browser.grant.csrf_token),
    data: request.body,
  });
}

async function sendMessage(input: {
  sender: AuthenticatedBrowser;
  recipient: AuthenticatedBrowser;
  text: string;
}): Promise<string> {
  const response = await mutate(input.sender, {
    path: '/api/v1/messages',
    body: {
      operation_id: randomUUID(),
      message_id: randomUUID(),
      destination: { kind: 'recipient', user_id: input.recipient.grant.user.id },
      content: {
        schema_version: 1,
        text: input.text,
        custom_emoji: [],
      },
    },
  });
  expect(response.status()).toBe(200);
  const receipt = await response.json();

  return receipt.conversation.id;
}

async function openPreferences(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notification defaults' })).toBeVisible();
}

function alertToast(page: Page) {
  return page.getByRole('status').filter({ hasText: new RegExp(`^${LIVE_ALERT}$`) });
}

function chatPane(page: Page) {
  return page.getByRole('region', { name: 'Chat', exact: true });
}

function nextSync(page: Page) {
  return page.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    return pathname === '/api/v1/chat/sync' && response.ok();
  });
}

function notificationHistory(page: Page, conversationId: string) {
  const historyPath = `/api/v1/conversations/${conversationId}/history`;
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === historyPath && url.searchParams.get('limit') === '1';
  });
}

async function assertBrowserCapability(page: Page) {
  const response = await page.request.get('/api/v1/notifications/capability');
  expect(response.status()).toBe(200);
  const capability = await response.json();
  const browserSettings = page.getByRole('region', { name: 'Browser notifications' });
  if (capability.available) {
    await expect(
      browserSettings.getByRole('button', { name: 'Enable browser notifications' }),
    ).toBeVisible();
    return;
  }

  await expect(
    browserSettings.getByText('Web Push is unavailable on this deployment.'),
  ).toBeVisible();
  await expect(browserSettings.getByRole('button')).toHaveCount(0);
}

async function assertLiveActivity(input: {
  page: Page;
  sender: AuthenticatedBrowser;
  conversationId: string;
}) {
  const { page, sender, conversationId } = input;
  const chat = chatPane(page);
  const privacy = await mutate(sender, {
    path: '/api/v1/account/privacy',
    method: 'PATCH',
    body: {
      direct_messages: 'everyone',
      calls: 'contacts',
      presence: 'everyone',
    },
  });
  expect(privacy.status()).toBe(200);

  const tabId = randomUUID();
  const heartbeat = await mutate(sender, {
    path: '/api/v1/activity/heartbeat',
    body: {
      tab_id: tabId,
      sequence: '1',
      is_foreground: true,
      conversation_id: conversationId,
    },
  });
  expect(heartbeat.status()).toBe(204);
  await expect(chat.getByText('Online', { exact: true })).toBeVisible({
    timeout: CONVERGENCE_TIMEOUT_MS,
  });

  const typingPath = `/api/v1/conversations/${conversationId}/typing`;
  const typing = await mutate(sender, {
    path: typingPath,
    body: {
      tab_id: tabId,
      sequence: '2',
      is_typing: true,
    },
  });
  expect(typing.status()).toBe(204);
  await expect(chat.getByText('Typing…', { exact: true })).toBeVisible();
  const stop = await mutate(sender, {
    path: typingPath,
    body: {
      tab_id: tabId,
      sequence: '3',
      is_typing: false,
    },
  });
  expect(stop.status()).toBe(204);
  await expect(chat.getByText('Typing…', { exact: true })).toHaveCount(0);
}

async function seedLocalPush(input: { page: Page; sessionId: string; subscriptionId: string }) {
  const { page, sessionId, subscriptionId } = input;
  await page.evaluate(
    async (mapping) => {
      // Provider delivery stays disabled in Compose. Only the browser subscription is synthetic.
      PushManager.prototype.getSubscription = async () => ({}) as PushSubscription;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('tg-chat-notifications-v1');
        request.onupgradeneeded = () => request.result.createObjectStore('notification-state');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const connection = request.result;
          const transaction = connection.transaction('notification-state', 'readwrite');
          const store = transaction.objectStore('notification-state');
          store.put({ subscription: mapping, receipts: [] }, 'browser-notifications');
          transaction.oncomplete = () => {
            connection.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    { sessionId, subscriptionId },
  );
}

async function registerNotificationWorker(page: Page) {
  return page.evaluate(async (scriptPath) => {
    await navigator.serviceWorker.register(scriptPath, { type: 'module', scope: '/' });
    const registration = await navigator.serviceWorker.ready;

    return { scope: registration.scope, script: registration.active?.scriptURL };
  }, WORKER_SCRIPT_PATH);
}

async function deliverDuplicatePush(input: {
  page: Page;
  origin: string;
  payload: SyntheticPush;
}): Promise<Worker> {
  const { page, origin, payload } = input;
  const context = page.context();
  const protocol = await context.newCDPSession(page);
  let registrationId: string | undefined;
  protocol.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
    const registration = registrations.find((entry) => entry.scopeURL === `${origin}/`);
    registrationId = registration?.registrationId ?? registrationId;
  });
  await protocol.send('ServiceWorker.enable');
  const workerReady = context.waitForEvent('serviceworker', (entry) => {
    return new URL(entry.url()).pathname === WORKER_SCRIPT_PATH;
  });
  await registerNotificationWorker(page);
  const worker = await workerReady;
  await expect.poll(() => registrationId).toBeTruthy();
  if (!registrationId) {
    throw new Error('Chromium did not register the notification worker.');
  }

  await worker.evaluate(() => {
    const scope = globalThis as unknown as ObservedWorker;
    scope.observation = { received: 0, displayed: [] };
    scope.addEventListener('push', () => scope.observation.received++);
    // Headless Chromium has no desktop notification center; observe the worker's display request.
    scope.registration.showNotification = async (title, options) => {
      scope.observation.displayed.push({ title, options });
    };
  });
  const delivery = {
    origin,
    registrationId,
    data: JSON.stringify({ ...payload, body: 'Private payload fields must stay hidden.' }),
  };
  await protocol.send('ServiceWorker.deliverPushMessage', delivery);
  await protocol.send('ServiceWorker.deliverPushMessage', delivery);
  await expect
    .poll(async () => {
      return worker.evaluate(async (lock) => {
        const scope = globalThis as unknown as ObservedWorker;
        await scope.navigator.locks.request(lock, async () => undefined);
        return scope.observation;
      }, NOTIFICATION_LOCK);
    })
    .toEqual({
      received: 2,
      displayed: [
        {
          title: 'New message',
          options: expect.objectContaining({
            body: 'Open TG Chat to view it.',
            data: payload,
          }),
        },
      ],
    });
  await protocol.detach();

  return worker;
}

async function clickNotification(input: { page: Page; worker: Worker; payload: SyntheticPush }) {
  const target = await input.worker.evaluate(async (notification) => {
    const scope = globalThis as unknown as ServiceWorkerGlobalScope;
    const matchAll = scope.clients.matchAll;
    let destination: string | undefined;
    const windowClient = {
      url: new URL('/', scope.location.origin).href,
      navigate: async (url: string) => {
        destination = url;
        return { focus: async () => undefined };
      },
    };
    // A synthetic click has no OS window activation. Capture the worker's requested navigation.
    scope.clients.matchAll = (async () => [windowClient]) as unknown as Clients['matchAll'];
    try {
      const event = new Event('notificationclick');
      let navigation: Promise<unknown> | undefined;
      Object.defineProperties(event, {
        notification: { value: { data: notification, close: () => undefined } },
        waitUntil: {
          value: (completion: Promise<unknown>) => {
            navigation = completion;
          },
        },
      });
      scope.dispatchEvent(event);
      await navigation;

      return destination;
    } finally {
      scope.clients.matchAll = matchAll;
    }
  }, input.payload);
  if (!target) {
    throw new Error('The notification did not request application navigation.');
  }
  await input.page.evaluate((url) => window.location.assign(url), target);
}

async function assertNotificationNavigation(input: {
  page: Page;
  recipient: AuthenticatedBrowser;
  conversationId: string;
}) {
  const { page, recipient, conversationId } = input;
  const subscriptionId = randomUUID();
  const payload = {
    identity: {
      deployment_id: randomUUID(),
      message_id: randomUUID(),
      subscription_id: subscriptionId,
    },
    conversation_id: conversationId,
  };
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
  await seedLocalPush({ page, sessionId: recipient.grant.session.id, subscriptionId });
  const worker = await deliverDuplicatePush({ page, origin: recipient.origin, payload });
  const authorizedHistory = notificationHistory(page, conversationId);
  await clickNotification({ page, worker, payload });
  expect((await authorizedHistory).status()).toBe(200);
  await expect(chatPane(page).getByRole('heading', { name: SENDER, exact: true })).toBeVisible();

  const close = await mutate(recipient, {
    path: '/api/v1/chat/commands',
    body: {
      conversation_id: conversationId,
      operation_id: randomUUID(),
      action: { kind: 'close' },
    },
  });
  expect(close.status()).toBe(200);
  const deniedHistory = notificationHistory(page, conversationId);
  await clickNotification({ page, worker, payload });
  expect((await deniedHistory).status()).toBe(404);
  await expect(chatPane(page).getByRole('heading', { name: 'Your messages' })).toBeVisible();
}

test('connected settings converge and foreground alerts follow the active conversation', async ({
  browser,
  context,
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:65413').origin;
  const senderContext = await browser.newContext({ baseURL: origin });
  const otherContext = await browser.newContext({ baseURL: origin });
  const recipientUsername = `m8_recipient_${randomUUID().slice(0, 8)}`;
  try {
    const sender = await admit({
      context: senderContext,
      origin,
      username: `m8_sender_${randomUUID().slice(0, 8)}`,
      displayName: SENDER,
    });
    const recipient = await admit({
      context,
      origin,
      username: recipientUsername,
      displayName: RECIPIENT,
    });
    await admit({ context: otherContext, origin, username: recipientUsername });
    const conversationId = await sendMessage({ sender, recipient, text: BACKFILL_MESSAGE });

    // Control the headless browser permission separately from the deployment capability.
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    });
    const otherPage = await otherContext.newPage();
    await Promise.all([openPreferences(page), openPreferences(otherPage)]);
    await assertBrowserCapability(page);
    await expect(alertToast(page)).toHaveCount(0);

    const sound = page.getByRole('checkbox', { name: 'Notification sound', exact: true });
    const otherSound = otherPage.getByRole('checkbox', { name: 'Notification sound', exact: true });
    const privatePreviews = page.getByRole('checkbox', { name: 'Private chats previews' });
    const otherPreviews = otherPage.getByRole('checkbox', { name: 'Private chats previews' });
    await expect(otherSound).toBeChecked();
    await expect(otherPreviews).toBeChecked();
    await page.bringToFront();
    await sound.uncheck();
    await privatePreviews.uncheck();
    const saved = page.waitForResponse((response) => {
      const pathname = new URL(response.url()).pathname;
      return pathname === '/api/v1/account/preferences' && response.request().method() === 'PATCH';
    });
    await page.getByRole('button', { name: 'Save notification defaults' }).click();
    expect((await saved).status()).toBe(200);
    await otherPage.bringToFront();
    await expect(otherSound).not.toBeChecked({ timeout: CONVERGENCE_TIMEOUT_MS });
    await expect(otherPreviews).not.toBeChecked();

    const resumed = nextSync(page);
    await page.bringToFront();
    await page.getByRole('button', { name: 'Messages', exact: true }).click();
    const directory = page.getByRole('complementary', { name: 'Conversations' });
    const conversation = directory.getByRole('button', { name: new RegExp(`^${SENDER}`) });
    await expect(conversation).toContainText(BACKFILL_MESSAGE);
    expect((await (await resumed).json()).has_more).toBe(false);
    await sendMessage({ sender, recipient, text: LIVE_MESSAGE });
    await expect(alertToast(page)).toBeVisible({ timeout: CONVERGENCE_TIMEOUT_MS });
    await page.keyboard.press('Escape');

    await conversation.click();
    const chat = chatPane(page);
    await expect(chat.getByRole('heading', { name: SENDER, exact: true })).toBeVisible();
    await sendMessage({ sender, recipient, text: ACTIVE_MESSAGE });
    await expect(chat.getByText(ACTIVE_MESSAGE, { exact: true })).toBeVisible();
    await expect(alertToast(page)).toHaveCount(0);

    await assertLiveActivity({ page, sender, conversationId });
    await assertNotificationNavigation({ page, recipient, conversationId });
  } finally {
    await otherContext.close();
    await senderContext.close();
  }
});

test('the connected build registers its notification worker at the origin root', async ({
  page,
}) => {
  await page.goto('/');
  const worker = await registerNotificationWorker(page);
  const origin = new URL(page.url()).origin;
  expect(worker).toEqual({
    scope: `${origin}/`,
    script: `${origin}/notification-worker.js`,
  });
});
