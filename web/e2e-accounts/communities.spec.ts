import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { components } from '../src/api/schema';

const PASSWORD = 'a complete community workflow password phrase';
const CONVERGENCE_TIMEOUT_MS = 15_000;
const SHORT_POSTING_MUTE_MS = 2500;

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

function chatHeading(page: Page, title: string) {
  return page
    .getByRole('region', { name: 'Chat', exact: true })
    .getByRole('heading', { name: title, exact: true });
}

async function createCommunity(options: { page: Page; kind: 'group' | 'channel'; title: string }) {
  await options.page.goto('/');
  await options.page.getByRole('button', { name: 'Main menu', exact: true }).click();
  const createEntry = options.kind === 'channel' ? 'New Channel' : 'New Group';
  await options.page.getByRole('menuitem', { name: createEntry, exact: true }).click();
  await expect(options.page.getByRole('heading', { name: createEntry, exact: true })).toBeVisible();
  await options.page.getByLabel('Community title').fill(options.title);
  await options.page.getByLabel('Public discovery').check();
  await options.page.getByLabel('Public handle').fill(`public_${randomUUID().slice(0, 8)}`);
  const acknowledged = options.page.waitForResponse((response) => {
    return response.url().endsWith('/api/v1/communities') && response.request().method() === 'POST';
  });
  await options.page.getByRole('button', { name: `Create ${options.kind}`, exact: true }).click();
  const response = await acknowledged;
  expect(response.status()).toBe(200);
  const receipt: components['schemas']['CommandReceipt'] = await response.json();
  await expect(chatHeading(options.page, options.title)).toBeVisible();
  return receipt.conversation!;
}

async function discoverAndJoin(options: { page: Page; title: string; label: string }) {
  await options.page.goto('/');
  await options.page
    .getByRole('textbox', { name: 'Search chats and messages' })
    .fill(options.title);
  const result = options.page.getByRole('article', { name: options.title, exact: true });
  await result.getByRole('button', { name: options.label, exact: true }).click();
}

async function openCommunity(page: Page, title: string) {
  await page.goto('/');
  const directory = page.getByRole('complementary', { name: 'Conversations' });
  await directory.getByRole('button', { name: new RegExp(`^${title}`) }).click();
  await expect(chatHeading(page, title)).toBeVisible();
}

async function openProfile(options: { page: Page; title: string; section?: string }) {
  const { page, title, section } = options;
  await page.getByRole('button', { name: `View ${title} profile`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /^(Group|Channel) info$/ });
  await expect(dialog).toBeVisible();
  if (section) {
    await dialog.getByRole('button', { name: section, exact: true }).click();
  }
  return dialog;
}

async function closeProfile(page: Page) {
  await page.getByRole('button', { name: 'Close community info', exact: true }).click();
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
  await openProfile({ page: owner.page, title: conversation.title, section: 'Invite links' });
  await owner.page.getByRole('button', { name: 'Create invite link', exact: true }).click();
  await expect(
    owner.page.getByText('Invite link created. Copy it before leaving this page.'),
  ).toBeVisible();
  await owner.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await owner.page.bringToFront();
  await owner.page.getByRole('button', { name: 'Copy invite link', exact: true }).click();
  const link = await owner.page.getByLabel('Invite link', { exact: true }).inputValue();
  await expect.poll(() => owner.page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  return link;
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
    await publish(owner.page, 'Retained group history');

    await discoverAndJoin({
      page: admin.page,
      title: group.title,
      label: 'Join group',
    });
    await expect(chatHeading(admin.page, group.title)).toBeVisible();
    const groupEditor = owner.page.getByRole('textbox', { name: 'Message', exact: true });
    await groupEditor.fill('Keep this draft while managing members');
    await openProfile({ page: owner.page, title: group.title, section: 'Members' });
    const administrator = owner.page.getByRole('article', {
      name: `Member ${admin.grant.user.username}`,
    });
    const adminActions = administrator.getByRole('button', {
      name: `Actions for ${admin.grant.user.display_name}`,
    });
    await adminActions.click();
    await owner.page.getByRole('menuitem', { name: 'Make administrator', exact: true }).click();
    await adminActions.click();
    await expect(
      owner.page.getByRole('menuitem', { name: 'Remove administrator', exact: true }),
    ).toBeVisible();
    await owner.page.keyboard.press('Escape');
    await closeProfile(owner.page);
    await expect(groupEditor).toHaveText('Keep this draft while managing members');

    await openProfile({ page: owner.page, title: group.title, section: 'Community settings' });
    await owner.page.getByLabel('Approve public and invite-link join requests').check();
    await owner.page.getByRole('button', { name: 'Save community settings', exact: true }).click();

    await discoverAndJoin({
      page: member.page,
      title: group.title,
      label: 'Request to join',
    });
    await expect(member.page.getByText('Request sent', { exact: true })).toBeVisible();
    await member.page.reload();
    await member.page.getByRole('textbox', { name: 'Search chats and messages' }).fill(group.title);
    await expect(member.page.getByText('Request sent', { exact: true })).toBeVisible();

    await openCommunity(admin.page, group.title);
    await openProfile({ page: admin.page, title: group.title, section: 'Join requests' });
    const request = admin.page.getByRole('article', {
      name: `Request ${member.grant.user.username}`,
    });
    await request.getByRole('button', { name: 'Approve', exact: true }).click();
    await closeProfile(admin.page);
    await publish(admin.page, 'Administrator publication');
    await member.page.getByRole('button', { name: `Open ${group.title}`, exact: true }).click();
    await expect(chatHeading(member.page, group.title)).toBeVisible();
    await expect(
      member.page.getByRole('group', { name: 'Message: Retained group history', exact: true }),
    ).toBeVisible();
    await expect(
      member.page
        .getByRole('group', {
          name: 'Message: Retained group history',
          exact: true,
        })
        .getByText(owner.grant.user.display_name, { exact: true }),
    ).toBeVisible();
    await expect(
      member.page
        .getByRole('group', {
          name: 'Message: Administrator publication',
          exact: true,
        })
        .getByText(admin.grant.user.display_name, { exact: true }),
    ).toBeVisible();
    await publish(member.page, 'Member publication');
    await command({
      account: admin,
      conversationId: group.id,
      action: {
        kind: 'mute',
        user_id: member.grant.user.id,
        until: new Date(Date.now() + SHORT_POSTING_MUTE_MS).toISOString(),
      },
    });
    await expect(member.page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
    await expect(member.page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({
      timeout: CONVERGENCE_TIMEOUT_MS,
    });

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
    await closeProfile(owner.page);
    await openProfile({ page: owner.page, title: group.title, section: 'Members' });
    const bannedMember = owner.page.getByRole('article', {
      name: `Member ${banned.grant.user.username}`,
    });
    await bannedMember
      .getByRole('button', { name: `Actions for ${banned.grant.user.display_name}` })
      .click();
    await owner.page.getByRole('menuitem', { name: 'Ban', exact: true }).click();
    await owner.page
      .getByRole('dialog', { name: 'Ban member?' })
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
    await expect(outsider.page.getByText('No other public communities found.')).toBeVisible();
    await outsider.page.goto(link);
    const invitation = outsider.page.getByRole('dialog', { name: group.title, exact: true });
    await expect(invitation).toBeVisible();
    const beforeJoin = await outsider.context.request.get(
      `/api/v1/conversations/${group.id}/history`,
    );
    expect(beforeJoin.status()).toBe(404);
    await invitation.getByRole('button', { name: 'Join group', exact: true }).click();
    await expect(chatHeading(outsider.page, group.title)).toBeVisible();
    await openProfile({ page: outsider.page, title: group.title });
    await outsider.page.getByRole('button', { name: 'Leave community', exact: true }).click();
    await outsider.page
      .getByRole('dialog', { name: 'Leave community?' })
      .getByRole('button', { name: 'Confirm', exact: true })
      .click();
    await expect(outsider.page.getByRole('dialog', { name: 'Group info' })).toHaveCount(0);
    await expect(chatHeading(outsider.page, group.title)).toHaveCount(0);

    const channel = await createCommunity({
      page: owner.page,
      kind: 'channel',
      title: `News channel ${randomUUID().slice(0, 8)}`,
    });
    await discoverAndJoin({ page: member.page, title: channel.title, label: 'Subscribe' });
    await expect(chatHeading(member.page, channel.title)).toBeVisible();
    await openProfile({ page: owner.page, title: channel.title, section: 'Community settings' });
    await owner.page.getByLabel('Public discovery').uncheck();
    await owner.page.getByRole('button', { name: 'Save community settings', exact: true }).click();
    await closeProfile(owner.page);
    await openProfile({ page: owner.page, title: channel.title, section: 'Invite links' });
    await owner.page.getByLabel('Invite username').fill(outsider.grant.user.username);
    await owner.page.getByRole('button', { name: 'Send invitation', exact: true }).click();
    await expect(
      owner.page.getByText('Invitation sent. The recipient must accept it.'),
    ).toBeVisible();
    await communities(outsider.page);
    await outsider.page.getByRole('button', { name: 'Invitations', exact: true }).click();
    await outsider.page
      .getByRole('article', { name: `Invitation ${channel.title}` })
      .getByRole('button', { name: 'Accept invitation' })
      .click();
    await expect(chatHeading(outsider.page, channel.title)).toBeVisible();
    const subscribers = await outsider.context.request.get(
      `/api/v1/communities/${channel.id}/members`,
    );
    expect(subscribers.status()).toBe(200);
    const subscriberPage =
      (await subscribers.json()) as components['schemas']['CommunityMemberPage'];
    expect(subscriberPage.items.map((entry) => entry.id)).toEqual([outsider.grant.user.id]);
    const muteChannel = outsider.page.getByRole('button', { name: 'Mute channel for one day' });
    await expect(muteChannel).toBeVisible();
    await muteChannel.click();
    const unmuteChannel = outsider.page.getByRole('button', { name: 'Unmute channel' });
    await expect(unmuteChannel).toBeVisible();
    await unmuteChannel.click();
    await expect(muteChannel).toBeVisible();
    await expect(outsider.page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(
      0,
    );
    await closeProfile(owner.page);
    await publish(owner.page, 'Channel publication');
    await outsider.page.bringToFront();
    const channelMessage = outsider.page.getByRole('group', {
      name: 'Message: Channel publication',
      exact: true,
    });
    await expect(channelMessage).toBeVisible({ timeout: CONVERGENCE_TIMEOUT_MS });
    await channelMessage.scrollIntoViewIfNeeded();
    await expect(channelMessage).toBeInViewport();
    const channelRow = outsider.page
      .getByRole('complementary', { name: 'Conversations' })
      .getByRole('button', { name: new RegExp(`^${channel.title}`) });
    const titleBounds = await channelRow.locator('strong').boundingBox();
    const timeBounds = await channelRow.locator('time').boundingBox();
    expect(titleBounds).not.toBeNull();
    expect(timeBounds).not.toBeNull();
    expect(titleBounds!.x + titleBounds!.width).toBeLessThanOrEqual(timeBounds!.x);
    await outsider.page.screenshot({ path: testInfo.outputPath('channel-desktop.png') });
    await outsider.page.setViewportSize({ width: 390, height: 844 });
    const profile = await openProfile({ page: outsider.page, title: channel.title });
    await expect(profile.getByText('3 subscribers', { exact: true })).toBeVisible();
    await expect(profile.getByRole('button', { name: 'Subscribers', exact: true })).toHaveCount(0);
    await outsider.page.screenshot({ path: testInfo.outputPath('community-mobile.png') });
  } finally {
    for (const context of contexts) {
      await context.close();
    }
  }
});
