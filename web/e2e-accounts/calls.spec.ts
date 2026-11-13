import { randomBytes, randomUUID } from 'node:crypto';
import { get } from 'node:http';
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import type { components } from '../src/api/schema';

const PASSWORD = 'a complete connected calls password phrase';
const MEDIA_TIMEOUT_MS = 20_000;
const MISSED_TIMEOUT_MS = 45_000;
const WEBSOCKET_KEY_BYTES = 16;

type Call = components['schemas']['CallView'];
type Credentials = components['schemas']['RoomCredentials'];
type History = components['schemas']['HistoryPage'];

interface Identity {
  username: string;
  displayName: string;
}

interface Device {
  context: BrowserContext;
  origin: string;
  page: Page;
  csrfToken: string;
}

function button(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true });
}

async function signIn(input: {
  context: BrowserContext;
  origin: string;
  identity: Identity;
  route: 'register' | 'login';
}): Promise<Device> {
  const { context, origin, identity, route } = input;
  const credentials = {
    username: identity.username,
    password: PASSWORD,
    device_name: 'Calls acceptance',
  };
  const requestBody =
    route === 'register' ? { ...credentials, display_name: identity.displayName } : credentials;
  const response = await context.request.post(`/api/v1/auth/${route}`, {
    headers: { origin, 'x-tg-chat-request': '1' },
    data: requestBody,
  });
  expect(response.status()).toBe(route === 'register' ? 201 : 200);
  const session: { csrf_token: string } = await response.json();
  const page = await context.newPage();
  page.setDefaultTimeout(MEDIA_TIMEOUT_MS);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();

  return { context, origin, page, csrfToken: session.csrf_token };
}

async function findPeer(page: Page, peer: Identity) {
  await button(page, 'Contacts').click();
  await button(page, 'Add contact').click();
  await page.getByLabel('Username or display name').fill(peer.username);
}

async function addContact(page: Page, peer: Identity) {
  await findPeer(page, peer);
  await button(page, 'Add contact').click();
  await expect(page.getByText('Relationship saved.')).toBeVisible();
}

async function openRecipient(page: Page, peer: Identity) {
  await addContact(page, peer);
  await button(page, 'Message').click();
  await expect(page.getByRole('heading', { name: peer.displayName, exact: true })).toBeVisible();

  // A first message creates the durable direct conversation that owns call history.
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Call acceptance chat');
  await button(page, 'Send message').click();
  await expect(page.getByRole('img', { name: 'Stored on server' })).toBeVisible();
}

async function currentCall(device: Device): Promise<Call | null> {
  const response = await device.context.request.get('/api/v1/calls/current');
  expect(response.status()).toBe(200);
  const current: components['schemas']['CurrentCall'] = await response.json();
  return current.call ?? null;
}

async function waitForPhase(device: Device, phase: Call['phase']) {
  await expect
    .poll(async () => (await currentCall(device))?.phase, {
      timeout: MEDIA_TIMEOUT_MS,
    })
    .toBe(phase);
  const call = await currentCall(device);
  expect(call).toBeTruthy();

  return call!;
}

async function getCredentials(device: Device, call: Call) {
  return device.context.request.post(`/api/v1/calls/${call.id}/credentials`, {
    headers: {
      origin: device.origin,
      'x-tg-chat-request': '1',
      'x-csrf-token': device.csrfToken,
    },
  });
}

async function expectRemoteAudio(page: Page) {
  await expect
    .poll(
      () =>
        page
          .locator('audio[data-call-audio]')
          .evaluateAll((elements) =>
            elements.some(
              (element) => element instanceof HTMLAudioElement && element.currentTime > 0,
            ),
          ),
      { timeout: MEDIA_TIMEOUT_MS },
    )
    .toBe(true);
}

async function expectRemoteVideo(page: Page) {
  const video = page.getByLabel('Peer camera');
  await expect(video).toBeVisible();
  await expect
    .poll(
      () =>
        video.evaluate(
          (element) =>
            element instanceof HTMLVideoElement &&
            element.videoWidth > 0 &&
            element.currentTime > 0,
        ),
      { timeout: MEDIA_TIMEOUT_MS },
    )
    .toBe(true);
}

async function expectOneHistoryEntry(input: {
  device: Device;
  call: Call;
  summary: string;
  timeout?: number;
}) {
  const { device, call, summary, timeout = MEDIA_TIMEOUT_MS } = input;
  await expect
    .poll(
      async () => {
        const response = await device.context.request.get(
          `/api/v1/conversations/${call.conversation_id}/history`,
        );
        expect(response.status()).toBe(200);
        const history: History = await response.json();
        return history.messages.filter(
          (message) => message.service_kind === 'call' && message.content.text.startsWith(summary),
        ).length;
      },
      { timeout },
    )
    .toBe(1);
}

function isAnswer(request: Request) {
  return (
    request.method() === 'POST' &&
    new URL(request.url()).pathname.endsWith('/commands') &&
    request.postDataJSON().action === 'accept'
  );
}

function signalingStatus(grant: Credentials): Promise<number | undefined> {
  const endpoint = new URL('/rtc', grant.url);
  endpoint.protocol = 'http:';
  endpoint.searchParams.set('access_token', grant.token);

  return new Promise((resolve, reject) => {
    const request = get(endpoint, {
      signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': randomBytes(WEBSOCKET_KEY_BYTES).toString('base64'),
      },
    });
    request.once('response', (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.once('upgrade', (response, socket) => {
      socket.destroy();
      resolve(response.statusCode);
    });
    request.once('error', reject);
  });
}

async function verifyFirstAnswer(input: { caller: Device; first: Device; second: Device }) {
  const { caller, first, second } = input;
  await button(caller.page, 'Start voice call').click();
  const firstAnswer = button(first.page, 'Answer');
  const secondAnswer = button(second.page, 'Answer');
  await Promise.all([expect(firstAnswer).toBeVisible(), expect(secondAnswer).toBeVisible()]);

  // Deliver both clicks before waiting for either answer's HTTP result.
  await Promise.all([
    first.page.waitForRequest(isAnswer),
    second.page.waitForRequest(isAnswer),
    firstAnswer.evaluate((element) => (element as HTMLButtonElement).click()),
    secondAnswer.evaluate((element) => (element as HTMLButtonElement).click()),
  ]);
  const call = await waitForPhase(caller, 'active');
  const [firstGrant, secondGrant] = await Promise.all([
    getCredentials(first, call),
    getCredentials(second, call),
  ]);
  const statuses = [firstGrant.status(), secondGrant.status()];
  expect(statuses.sort()).toEqual([200, 403]);
  const winner = firstGrant.ok() ? first : second;
  const loser = firstGrant.ok() ? second : first;
  const grant: Credentials = await (firstGrant.ok() ? firstGrant : secondGrant).json();

  await expect(button(loser.page, 'Answer')).toBeHidden();
  await Promise.all([expectRemoteAudio(caller.page), expectRemoteAudio(winner.page)]);
  await button(winner.page, 'Mute').click();
  await expect(button(winner.page, 'Unmute')).toBeVisible();
  await button(winner.page, 'Unmute').click();
  await expect(button(winner.page, 'Mute')).toBeVisible();

  await button(caller.page, 'Hang up').click();
  await expectOneHistoryEntry({ device: winner, call, summary: 'Voice call · completed' });

  // A previously issued credential cannot open new signaling through our own gateway.
  expect(Date.parse(grant.expires_at)).toBeGreaterThan(Date.now());
  expect(await signalingStatus(grant)).toBe(403);
}

async function verifyVideo(input: { caller: Device; recipient: Device }) {
  const { caller, recipient } = input;
  await button(caller.page, 'Start video call').click();
  await button(recipient.page, 'Answer').click();
  const call = await waitForPhase(caller, 'active');
  await Promise.all([expectRemoteVideo(caller.page), expectRemoteVideo(recipient.page)]);
  // Reload replaces the owning tab's media resources. Rejoining requires a new user gesture.
  await recipient.page.reload();
  await button(recipient.page, 'Enable microphone and camera').click();
  await Promise.all([expectRemoteVideo(caller.page), expectRemoteVideo(recipient.page)]);
  await button(recipient.page, 'Hang up').click();
  await expectOneHistoryEntry({ device: caller, call, summary: 'Video call · completed' });
}

async function verifyPermissionDenied(input: { caller: Device; recipient: Device }) {
  const { caller, recipient } = input;
  const session = await recipient.context.newCDPSession(recipient.page);
  const { targetInfo } = await session.send('Target.getTargetInfo');
  const permission = {
    permission: { name: 'microphone' },
    origin: recipient.origin,
    browserContextId: targetInfo.browserContextId,
  };
  await session.send('Browser.setPermission', { ...permission, setting: 'denied' });
  try {
    await button(caller.page, 'Start voice call').click();
    const call = await waitForPhase(caller, 'ringing');
    await button(recipient.page, 'Answer').click();
    const permissionMessage = recipient.page.getByRole('alert');
    await expect(permissionMessage).toContainText('Microphone or camera permission was denied.');
    await expectOneHistoryEntry({
      device: caller,
      call,
      summary: 'Voice call · media permission denied',
    });
  } finally {
    await session.send('Browser.setPermission', { ...permission, setting: 'granted' });
    await session.detach();
  }
}

async function verifyMissed(input: { caller: Device; recipient: Device; callerName: string }) {
  const { caller, recipient, callerName } = input;
  await button(caller.page, 'Start voice call').click();
  const call = await waitForPhase(caller, 'ringing');
  await expect(button(recipient.page, 'Answer')).toBeVisible();
  await recipient.page.close();
  await expectOneHistoryEntry({
    device: caller,
    call,
    summary: 'Voice call · missed',
    timeout: MISSED_TIMEOUT_MS,
  });

  const reopened = await recipient.context.newPage();
  await reopened.goto('/');
  await reopened.getByRole('button', { name: new RegExp(`^${callerName}`) }).click();
  const chat = reopened.getByRole('region', { name: 'Chat', exact: true });
  await expect(chat.getByText('Voice call · missed', { exact: true })).toHaveCount(1);
}

test('connected calls arbitrate answers, carry media, resume, and persist missed history', async ({
  browser,
  page,
  baseURL,
}) => {
  test.setTimeout(150_000);
  const origin = new URL(baseURL!).origin;
  const callerIdentity = { username: `caller_${randomUUID().slice(0, 8)}`, displayName: 'Caller' };
  const calleeIdentity = { username: `callee_${randomUUID().slice(0, 8)}`, displayName: 'Callee' };
  const contextOptions = { baseURL, permissions: ['microphone', 'camera'] };
  const firstContext = await browser.newContext(contextOptions);
  const secondContext = await browser.newContext(contextOptions);
  try {
    const caller = await signIn({
      context: page.context(),
      origin,
      identity: callerIdentity,
      route: 'register',
    });
    const first = await signIn({
      context: firstContext,
      origin,
      identity: calleeIdentity,
      route: 'register',
    });
    const second = await signIn({
      context: secondContext,
      origin,
      identity: calleeIdentity,
      route: 'login',
    });

    await addContact(first.page, callerIdentity);
    await openRecipient(caller.page, calleeIdentity);
    await test.step('First answer wins and terminal signaling is rejected', () =>
      verifyFirstAnswer({ caller, first, second }));
    await secondContext.close();
    await test.step('Both peers play video again after one browser reloads', () =>
      verifyVideo({ caller, recipient: first }));
    await test.step('Chromium microphone denial ends the call with its own outcome', () =>
      verifyPermissionDenied({ caller, recipient: first }));
    await test.step('An unanswered call appears once in reopened history', () =>
      verifyMissed({ caller, recipient: first, callerName: callerIdentity.displayName }));
  } finally {
    await Promise.all([firstContext.close(), secondContext.close()]);
  }
});
