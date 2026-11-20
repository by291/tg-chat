import { randomUUID } from 'node:crypto';
import { expect, test as baseTest, type BrowserContext, type Page } from '@playwright/test';
import type { components } from '../src/api/schema';
import { closeContexts, mutationHeaders as headers, registerAccount } from './accountFixtures';

const PASSWORD = 'a complete community workflow password phrase';
export const CONVERGENCE_TIMEOUT_MS = 15_000;
const COMMUNITY_ACCOUNTS = 5;

export interface Account {
  context: BrowserContext;
  page: Page;
  grant: components['schemas']['AuthResponse'];
  origin: string;
}

interface CommunityFixtures {
  accounts: Account[];
  accountCount: number;
}

/** Apply a community mutation through the public API and verify its status. */
export async function command(options: {
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

/** Open the community discovery workspace. */
export async function communities(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Communities', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Communities', exact: true })).toBeVisible();
}

/** Locate the active conversation heading without matching sidebar labels. */
export function chatHeading(page: Page, title: string) {
  return page
    .getByRole('region', { name: 'Chat', exact: true })
    .getByRole('heading', { name: title, exact: true });
}

/** Create a community through its visible form and return its accepted projection. */
export async function createCommunity(options: {
  page: Page;
  kind: 'group' | 'channel';
  title: string;
}) {
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

/** Join or subscribe through a public discovery result. */
export async function discoverAndJoin(options: { page: Page; title: string; label: string }) {
  await options.page.goto('/');
  await options.page
    .getByRole('textbox', { name: 'Search chats and messages' })
    .fill(options.title);
  const result = options.page.getByRole('article', { name: options.title, exact: true });
  await result.getByRole('button', { name: options.label, exact: true }).click();
}

/** Open an existing community from the participant directory. */
export async function openCommunity(page: Page, title: string) {
  await page.goto('/');
  const directory = page.getByRole('complementary', { name: 'Conversations' });
  await directory.getByRole('button', { name: new RegExp(`^${title}`) }).click();
  await expect(chatHeading(page, title)).toBeVisible();
}

/** Open the community profile and optional management section. */
export async function openProfile(options: { page: Page; title: string; section?: string }) {
  const { page, title, section } = options;
  await page.getByRole('button', { name: `View ${title} profile`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /^(Group|Channel) info$/ });
  await expect(dialog).toBeVisible();
  if (section) {
    await dialog.getByRole('button', { name: section, exact: true }).click();
  }
  return dialog;
}

/** Close the community profile without changing the conversation. */
export async function closeProfile(page: Page) {
  await page.getByRole('button', { name: 'Close community info', exact: true }).click();
}

/** Publish a message through the composer and observe the accepted content. */
export async function publish(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('group', { name: `Message: ${text}`, exact: true })).toBeVisible();
}

/** Make the group private and copy a newly created invitation link. */
export async function createPrivateInvitation(
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

export const test = baseTest.extend<CommunityFixtures>({
  accountCount: [COMMUNITY_ACCOUNTS, { option: true }],
  accounts: async ({ browser, baseURL, accountCount }, use) => {
    if (!baseURL) {
      throw new Error('Connected community tests require a base URL.');
    }
    const contexts: BrowserContext[] = [];
    const accounts: Account[] = [];
    try {
      for (let index = 0; index < accountCount; index += 1) {
        const context = await browser.newContext({ baseURL });
        contexts.push(context);
        const username = `community_${randomUUID().slice(0, 8)}`;
        const grant = await registerAccount({
          context,
          origin: baseURL,
          username,
          displayName: username,
          password: PASSWORD,
          deviceName: 'Community browser',
        });
        accounts.push({
          context,
          page: await context.newPage(),
          grant,
          origin: baseURL,
        });
      }
      await use(accounts);
    } finally {
      await closeContexts(contexts);
    }
  },
});
