import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { components } from '../src/api/schema';

const PASSWORD = 'a complete community workflow password phrase';
const CONVERGENCE_TIMEOUT_MS = 15_000;

interface Account {
  context: BrowserContext;
  page: Page;
  grant: components['schemas']['AuthResponse'];
  origin: string;
}

async function register(context: BrowserContext, origin: string): Promise<Account> {
  const username = `community_${randomUUID().slice(0, 8)}`;
  const response = await context.request.post('/api/v1/auth/register', {
    headers: { origin, 'x-tg-chat-request': '1' },
    data: {
      username,
      display_name: username,
      password: PASSWORD,
      device_name: 'Community browser',
    },
  });
  expect(response.status()).toBe(201);
  return {
    context,
    page: await context.newPage(),
    grant: await response.json(),
    origin,
  };
}

function headers(account: Account) {
  return {
    origin: account.origin,
    'x-tg-chat-request': '1',
    'x-csrf-token': account.grant.csrf_token,
  };
}

async function command(options: {
  account: Account;
  conversationId: string;
  action: components['schemas']['CommunityAction'];
  expectedStatus?: number;
}) {
  const response = await options.account.context.request.post('/api/v1/communities/commands', {
    headers: headers(options.account),
    data: {
      operation_id: randomUUID(),
      conversation_id: options.conversationId,
      action: options.action,
    },
  });
  expect(response.status()).toBe(options.expectedStatus ?? 200);
  return response;
}

async function communities(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Communities', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Communities', exact: true })).toBeVisible();
}

async function createCommunity(options: { page: Page; kind: string; title: string }) {
  await communities(options.page);
  await options.page.getByLabel('Community type').selectOption(options.kind);
  await options.page.getByLabel('Community title').fill(options.title);
  await options.page.getByLabel('Public discovery').check();
  await options.page.getByLabel('Public handle').fill(`public_${randomUUID().slice(0, 8)}`);
  const acknowledged = options.page.waitForResponse((response) => {
    return response.url().endsWith('/api/v1/communities') && response.request().method() === 'POST';
  });
  await options.page.getByRole('button', { name: 'Create community', exact: true }).click();
  const response = await acknowledged;
  expect(response.status()).toBe(200);
  const receipt: components['schemas']['CommandReceipt'] = await response.json();
  await expect(
    options.page.getByRole('heading', { name: options.title, exact: true }),
  ).toBeVisible();
  return receipt.conversation!;
}

async function discoverAndJoin(options: { page: Page; title: string; label: string }) {
  await communities(options.page);
  await options.page.getByLabel('Community search').fill(options.title);
  await options.page.getByRole('button', { name: 'Search communities', exact: true }).click();
  const result = options.page.getByRole('article', { name: options.title, exact: true });
  await result.getByRole('button', { name: options.label, exact: true }).click();
}

async function openCommunity(page: Page, title: string) {
  await communities(page);
  await page.getByRole('button', { name: new RegExp(`^${title} ·`) }).click();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

async function publish(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('group', { name: `Message: ${text}`, exact: true })).toBeVisible();
}

async function createPrivateInvitation(
  owner: Account,
  conversation: components['schemas']['ConversationView'],
) {
  await command({
    account: owner,
    conversationId: conversation.id,
    action: {
      kind: 'settings',
      expected_version: conversation.settings_version,
      settings: {
        title: conversation.title,
        description: 'Private retained history',
        is_public: false,
        public_handle: conversation.public_handle,
        requires_approval: false,
      },
    },
  });
  await openCommunity(owner.page, conversation.title);
  await owner.page.getByRole('button', { name: 'Community details', exact: true }).click();
  await owner.page.getByRole('button', { name: 'Create invite link', exact: true }).click();
  await expect(
    owner.page.getByText('Invite link created. Copy it before leaving this page.'),
  ).toBeVisible();
  return owner.page.getByLabel('Invite link', { exact: true }).inputValue();
}

test('five accounts observe admission, moderation, private links, and channel permissions', async ({
  browser,
  baseURL,
}, testInfo) => {
  const contexts: BrowserContext[] = [];
  const accounts: Account[] = [];
  try {
    for (let index = 0; index < 5; index += 1) {
      const context = await browser.newContext({ baseURL });
      contexts.push(context);
      accounts.push(await register(context, baseURL!));
    }
    const [owner, admin, member, outsider, banned] = accounts;
    const group = await createCommunity({
      page: owner.page,
      kind: 'group',
      title: `Study group ${randomUUID().slice(0, 8)}`,
    });
    await owner.page.getByRole('button', { name: 'Open conversation', exact: true }).click();
    await publish(owner.page, 'Retained group history');

    await discoverAndJoin({
      page: admin.page,
      title: group.title,
      label: 'Join community',
    });
    await owner.page.getByRole('button', { name: 'Community details', exact: true }).click();
    const administrator = owner.page.getByRole('article', {
      name: `Member ${admin.grant.user.username}`,
    });
    await administrator.getByRole('button', { name: 'Make administrator', exact: true }).click();
    await expect(
      administrator.getByRole('button', { name: 'Remove administrator', exact: true }),
    ).toBeVisible();
    await owner.page.getByLabel('Approve public and invite-link join requests').check();
    await owner.page.getByRole('button', { name: 'Save community settings', exact: true }).click();

    await discoverAndJoin({
      page: member.page,
      title: group.title,
      label: 'Request to join',
    });
    await expect(member.page.getByText('Request recorded.', { exact: false })).toBeVisible();
    await openCommunity(admin.page, group.title);
    await admin.page.getByRole('button', { name: 'Community details', exact: true }).click();
    const request = admin.page.getByRole('article', {
      name: `Request ${member.grant.user.username}`,
    });
    await request.getByRole('button', { name: 'Approve', exact: true }).click();
    await openCommunity(member.page, group.title);
    await expect(
      member.page.getByRole('group', { name: 'Message: Retained group history', exact: true }),
    ).toBeVisible();
    await publish(member.page, 'Member publication');

    await command({
      account: banned,
      conversationId: group.id,
      action: { kind: 'join' },
    });
    await command({
      account: admin,
      conversationId: group.id,
      action: { kind: 'approve', user_id: banned.grant.user.id },
    });
    await openCommunity(banned.page, group.title);
    await expect(
      banned.page.getByRole('group', { name: 'Message: Retained group history', exact: true }),
    ).toBeVisible();
    const bannedMember = owner.page.getByRole('article', {
      name: `Member ${banned.grant.user.username}`,
    });
    await bannedMember.getByRole('button', { name: 'Ban', exact: true }).click();
    await owner.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirm', exact: true })
      .click();
    await expect(
      banned.page.getByRole('group', { name: 'Message: Retained group history', exact: true }),
    ).toHaveCount(0, { timeout: CONVERGENCE_TIMEOUT_MS });
    const denied = await banned.context.request.get(`/api/v1/conversations/${group.id}/history`);
    expect(denied.status()).toBe(404);
    await command({
      account: banned,
      conversationId: group.id,
      action: { kind: 'join' },
      expectedStatus: 404,
    });

    const current = await owner.context.request.get(`/api/v1/communities/${group.id}`);
    const link = await createPrivateInvitation(owner, await current.json());
    await communities(outsider.page);
    await outsider.page.getByLabel('Community search').fill(group.title);
    await outsider.page.getByRole('button', { name: 'Search communities', exact: true }).click();
    await expect(
      outsider.page.getByRole('article', { name: group.title, exact: true }),
    ).toHaveCount(0);
    await outsider.page.getByLabel('Invitation link or secret').fill(link);
    await outsider.page.getByRole('button', { name: 'Preview invitation', exact: true }).click();
    await outsider.page
      .getByRole('button', { name: 'Join through invitation', exact: true })
      .click();
    await expect(
      outsider.page.getByRole('heading', { name: group.title, exact: true }),
    ).toBeVisible();
    await outsider.page.getByRole('button', { name: 'Leave community', exact: true }).click();
    await outsider.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirm', exact: true })
      .click();
    await expect(
      outsider.page.getByRole('heading', { name: 'Communities', exact: true }),
    ).toBeVisible();

    const channel = await createCommunity({
      page: owner.page,
      kind: 'channel',
      title: `News channel ${randomUUID().slice(0, 8)}`,
    });
    await owner.page.getByLabel('Public discovery').uncheck();
    await owner.page.getByRole('button', { name: 'Save community settings', exact: true }).click();
    await expect(owner.page.getByText('channel · private · Your role: owner')).toBeVisible();
    await owner.page.getByLabel('Invite username').fill(outsider.grant.user.username);
    await owner.page.getByRole('button', { name: 'Send invitation', exact: true }).click();
    await expect(
      owner.page.getByText('Invitation sent. The recipient must accept it.'),
    ).toBeVisible();
    await communities(outsider.page);
    await outsider.page
      .getByRole('article', { name: `Invitation ${channel.title}` })
      .getByRole('button', { name: 'Accept invitation' })
      .click();
    await expect(
      outsider.page.getByText('Only administrators can view other subscribers.'),
    ).toBeVisible();
    const subscribers = await outsider.context.request.get(
      `/api/v1/communities/${channel.id}/members`,
    );
    const subscriberPage = await subscribers.json();
    expect(subscriberPage.items.map((entry: { id: string }) => entry.id)).toEqual([
      outsider.grant.user.id,
    ]);
    await outsider.page.getByRole('button', { name: 'Open conversation', exact: true }).click();
    await expect(outsider.page.getByText('You cannot post in this conversation.')).toBeVisible();
    await expect(outsider.page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(
      0,
    );
    await owner.page.getByRole('button', { name: 'Open conversation', exact: true }).click();
    await publish(owner.page, 'Channel publication');
    await expect(
      outsider.page.getByRole('group', { name: 'Message: Channel publication', exact: true }),
    ).toBeVisible({ timeout: CONVERGENCE_TIMEOUT_MS });
    await outsider.page.screenshot({ path: testInfo.outputPath('channel-desktop.png') });
    await outsider.page.setViewportSize({ width: 390, height: 844 });
    await outsider.page.getByRole('button', { name: 'Community details', exact: true }).click();
    await outsider.page.screenshot({ path: testInfo.outputPath('community-mobile.png') });
  } finally {
    for (const context of contexts) {
      await context.close();
    }
  }
});
