import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const PASSWORD = 'a complete browser password phrase';
const REPLACEMENT_PASSWORD = 'a replacement browser password phrase';
const MAILPIT = process.env.TG_CHAT_MAILPIT_TEST_URL ?? 'http://127.0.0.1:65410';
const DELIVERY_TIMEOUT_MS = 30_000;

interface Identity {
  username: string;
  displayName: string;
}

interface CapturedMessage {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

function identity(displayName: string): Identity {
  return { username: `user_${randomUUID().slice(0, 8)}`, displayName };
}

async function register(page: Page, account: Identity) {
  await page.goto('/');
  await expect(page.locator('#startup-frame')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill(account.username);
  await page.getByLabel('Display name', { exact: true }).fill(account.displayName);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
}

async function login(options: { page: Page; account: Identity; password?: string }) {
  await options.page.goto('/');
  await options.page.getByLabel('Username', { exact: true }).fill(options.account.username);
  await options.page.getByLabel('Password', { exact: true }).fill(options.password ?? PASSWORD);
  await options.page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(options.page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
}

async function openAccountSettings(page: Page) {
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
}

async function openPrivacy(page: Page) {
  await openAccountSettings(page);
  await page.getByRole('button', { name: 'Privacy and Security', exact: true }).click();
}

async function openSecurity(page: Page) {
  await openPrivacy(page);
  await page.getByRole('button', { name: 'Password & recovery', exact: true }).click();
}

async function mailLink(options: {
  request: APIRequestContext;
  recipient: string;
  subject: string;
}): Promise<string> {
  let messageId: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await options.request.get(`${MAILPIT}/api/v1/messages`);
        const mailbox = (await response.json()) as { messages: CapturedMessage[] };
        const message = mailbox.messages.find((message) => {
          const matchesRecipient = message.To.some(
            (recipient) => recipient.Address === options.recipient,
          );
          return matchesRecipient && message.Subject === options.subject;
        });
        messageId = message?.ID;
        return Boolean(messageId);
      },
      { timeout: DELIVERY_TIMEOUT_MS },
    )
    .toBe(true);
  const response = await options.request.get(`${MAILPIT}/api/v1/message/${messageId}`);
  const message = (await response.json()) as { Text: string };
  const line = message.Text.split('\n').find((line) => line.includes('#token='));
  if (!line) {
    throw new Error('The captured email did not contain an account link.');
  }

  return line.trim();
}

test('two accounts keep profiles and relationships isolated while device and tab revocation take effect', async ({
  browser,
  page,
}) => {
  const alice = identity('Alice Browser');
  const bobby = identity('Bobby Browser');
  const bobbyContext = await browser.newContext();
  const peerContext = await browser.newContext();
  const bobbyPage = await bobbyContext.newPage();
  const peerPage = await peerContext.newPage();
  try {
    await register(page, alice);
    await openAccountSettings(page);
    await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Change photo' })).toBeDisabled();
    await page.getByLabel('Phone (private)').fill('private-alice-phone');
    await page.getByLabel('Biography').fill('A public Alice biography.');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Back to settings' }).click();
    await page.getByRole('button', { name: 'Back to chats' }).click();
    const sibling = await page.context().newPage();
    await sibling.goto('/');
    await expect(sibling.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();

    await register(bobbyPage, bobby);
    await bobbyPage.getByRole('button', { name: 'Contacts', exact: true }).click();
    await bobbyPage.getByRole('button', { name: 'Add contact', exact: true }).click();
    await bobbyPage.getByLabel('Username or display name').fill(alice.username);
    await expect(bobbyPage.getByText('A public Alice biography.')).toBeVisible();
    await expect(bobbyPage.getByText('private-alice-phone')).toHaveCount(0);
    await bobbyPage.getByRole('button', { name: 'Add contact', exact: true }).click();
    await expect(bobbyPage.getByText('Relationship saved.')).toBeVisible();
    await bobbyPage.getByRole('button', { name: 'Back to contacts' }).click();
    await expect(bobbyPage.getByText(`@${alice.username}`, { exact: true })).toBeVisible();
    await bobbyPage.getByRole('button', { name: 'Block', exact: true }).click();
    await bobbyPage.getByRole('button', { name: 'Back to chats' }).click();
    await openPrivacy(bobbyPage);
    await bobbyPage.getByRole('button', { name: 'Blocked users', exact: true }).click();
    await bobbyPage.getByRole('button', { name: 'Unblock', exact: true }).click();
    await expect(bobbyPage.getByRole('button', { name: 'Unblock', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Contacts', exact: true }).click();
    await expect(page.getByText(`@${bobby.username}`, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to chats' }).click();
    await openPrivacy(page);
    await page.getByRole('button', { name: 'Calls My contacts' }).click();
    await page.getByRole('radio', { name: 'Nobody' }).check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Privacy settings saved.')).toBeVisible();
    await page.reload();
    await openPrivacy(page);
    await page.getByRole('button', { name: 'Calls Nobody' }).click();
    await expect(page.getByRole('radio', { name: 'Nobody' })).toBeChecked();

    await login({ page: peerPage, account: alice });
    await page.getByRole('button', { name: 'Back to privacy and security' }).click();
    await page.getByRole('button', { name: 'Back to settings' }).click();
    await page.getByRole('button', { name: 'Devices', exact: true }).click();
    const otherSessions = page.getByRole('region', { name: 'Other sessions' });
    await otherSessions.getByRole('button').click();
    await page.getByRole('button', { name: 'Sign out this device' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Confirm sign-out' });
    await confirmation.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByText('Device signed out.')).toBeVisible();
    await peerPage.reload();
    await expect(peerPage.getByRole('heading', { name: 'Welcome to TG Chat' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to settings' }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(sibling.getByRole('heading', { name: 'Welcome to TG Chat' })).toBeVisible();
    await expect(
      bobbyPage.getByRole('heading', { name: 'Blocked users', exact: true }),
    ).toBeVisible();
    await login({ page, account: bobby });
    await openAccountSettings(page);
    await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
    await expect(page.getByLabel('Phone (private)')).toHaveValue('');
    const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
    expect(stored).not.toContain('private-alice-phone');
    expect(stored).not.toContain(alice.username);
  } finally {
    await bobbyContext.close();
    await peerContext.close();
  }
});

test('real SMTP verification and single-use recovery links replace credentials and revoke old browsers', async ({
  browser,
  page,
  request,
}) => {
  const account = identity('Recovery Browser');
  const recipient = `${account.username}@example.test`;
  const recoveryContext = await browser.newContext();
  const recoveryPage = await recoveryContext.newPage();
  try {
    await register(page, account);
    await openSecurity(page);
    await page.getByLabel('Recovery email', { exact: true }).fill(recipient);
    await page.getByRole('button', { name: 'Send verification email' }).click();
    await expect(
      page.getByText('Verification email queued. Open the link within 15 minutes.'),
    ).toBeVisible();
    const verification = await mailLink({
      request,
      recipient,
      subject: 'Verify your TG Chat email',
    });
    await recoveryPage.goto(verification);
    await expect(recoveryPage).toHaveURL(/\/account\/verify-email$/);
    await recoveryPage.getByRole('button', { name: 'Verify email', exact: true }).click();
    await expect(recoveryPage.getByRole('status')).toHaveText(
      'Email verified. Your recovery address is ready.',
    );
    await page.reload();
    await openSecurity(page);
    await expect(page.getByText(recipient, { exact: true })).toBeVisible();

    await recoveryPage.goto('/');
    await recoveryPage.getByRole('button', { name: 'Forgot password' }).click();
    await recoveryPage.getByLabel('Verified email').fill(recipient);
    await recoveryPage.getByRole('button', { name: 'Send recovery link' }).click();
    await expect(recoveryPage.getByRole('status')).toContainText(
      'If a verified account uses this email',
    );
    const recovery = await mailLink({
      request,
      recipient,
      subject: 'Reset your TG Chat password',
    });
    await recoveryPage.goto(recovery);
    await expect(recoveryPage).toHaveURL(/\/account\/reset-password$/);
    await recoveryPage.getByLabel('New password', { exact: true }).fill(REPLACEMENT_PASSWORD);
    await recoveryPage.getByLabel('Repeat new password').fill(REPLACEMENT_PASSWORD);
    await recoveryPage.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect(recoveryPage.getByRole('status')).toContainText('Password reset.');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome to TG Chat' })).toBeVisible();
    await login({
      page,
      account,
      password: REPLACEMENT_PASSWORD,
    });

    await recoveryPage.goto(recovery);
    await recoveryPage.getByLabel('New password', { exact: true }).fill(REPLACEMENT_PASSWORD);
    await recoveryPage.getByLabel('Repeat new password').fill(REPLACEMENT_PASSWORD);
    await recoveryPage.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect(recoveryPage.getByRole('alert')).toHaveText('the link is invalid or has expired');
  } finally {
    await recoveryContext.close();
  }
});
