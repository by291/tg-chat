import { expect, type BrowserContext, type Page } from '@playwright/test';
import type { components } from '../src/api/schema';
import { registerAccount } from './accountFixtures';

const PASSWORD = 'a complete synchronization password phrase';
export const CONVERGENCE_TIMEOUT_MS = 15_000;

interface Account {
  username: string;
  displayName: string;
}

/** Establish a registered or additional session for a synchronization participant. */
export async function authenticate(options: {
  context: BrowserContext;
  origin: string;
  account: Account;
  isRegistration: boolean;
}): Promise<components['schemas']['AuthResponse']> {
  if (options.isRegistration) {
    return registerAccount({
      context: options.context,
      origin: options.origin,
      username: options.account.username,
      displayName: options.account.displayName,
      password: PASSWORD,
      deviceName: 'Synchronization browser',
    });
  }

  const response = await options.context.request.post('/api/v1/auth/login', {
    headers: {
      origin: options.origin,
      'x-tg-chat-request': '1',
    },
    data: {
      username: options.account.username,
      password: PASSWORD,
      device_name: 'Synchronization browser',
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as components['schemas']['AuthResponse'];
}

/** Open the participant conversation through its visible directory entry. */
export async function openChat(page: Page, peer: Account) {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(peer.displayName) }).click();
  await expect(page.getByRole('heading', { name: peer.displayName, exact: true })).toBeVisible();
}

/** Require the accepted message projection in every participating browser. */
export async function visibleEverywhere(pages: Page[], text: string) {
  for (const page of pages) {
    await expect(page.getByRole('group', { name: `Message: ${text}`, exact: true })).toBeVisible({
      timeout: CONVERGENCE_TIMEOUT_MS,
    });
  }
}
