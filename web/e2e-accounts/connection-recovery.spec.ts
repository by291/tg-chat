import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const PASSWORD = 'a complete browser password phrase';

test('retries first load in place and preserves the open mobile draft during reconnection', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/chat/bootstrap', (route) =>
    route.fulfill({ status: 502, contentType: 'text/plain', body: 'Gateway unavailable' }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill(`recovery_${randomUUID().slice(0, 8)}`);
  await page.getByLabel('Display name', { exact: true }).fill('Recovery Browser');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();

  const retry = page.getByRole('button', { name: 'Retry loading chats', exact: true });
  await expect(retry).toBeVisible();
  const reconnecting = page.getByRole('status').filter({ hasText: 'Reconnecting…' });
  await expect(reconnecting).toBeVisible();
  await page.unroute('**/api/v1/chat/bootstrap');
  await retry.click();
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
  await expect(retry).toHaveCount(0);

  await page.getByRole('button', { name: /^Saved Messages/ }).click();
  const editor = page.getByRole('textbox', { name: 'Message', exact: true });
  await editor.fill('Keep this during recovery');

  // Resume the same view while the HTTP catch-up request is still in flight.
  let releaseCatchUp: () => void = () => undefined;
  const catchUpGate = new Promise<void>((resolve) => {
    releaseCatchUp = resolve;
  });
  await context.setOffline(true);
  await expect(page.getByRole('status').filter({ hasText: 'Waiting for network…' })).toBeVisible();
  await expect(editor).toHaveText('Keep this during recovery');
  await page.route('**/api/v1/chat/sync?*', async (route) => {
    await catchUpGate;
    await route.continue();
  });
  try {
    await context.setOffline(false);
    await expect(reconnecting).toBeVisible();
    await expect(editor).toHaveText('Keep this during recovery');
  } finally {
    releaseCatchUp();
  }

  await expect(reconnecting).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Saved Messages', exact: true })).toBeVisible();
  await expect(editor).toHaveText('Keep this during recovery');
});
