import { expect, test } from '@playwright/test';
import { waitForHistoryLayout } from './historyViewport';

const EDITOR_TEXT = 'Keep this selected';
const LINK_URL = 'https://example.com/notes';
const HISTORY_SCROLL_DISTANCE = -1200;
const RESIZED_VIEWPORT = { width: 1050, height: 720 };
const ANCHOR_TOLERANCE = 2;

test('archive search receives focus and can broaden its scope', async ({ page }) => {
  await page.goto('/?chat=dev');
  const designChat = page.getByRole('button', { name: /^Design conversations/ });
  await designChat.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await expect(designChat).toHaveCount(0);

  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /Archived Chats/ }).click();
  await page.getByRole('button', { name: 'Archive options' }).click();
  await page.getByRole('menuitem', { name: 'Search', exact: true }).click();

  const search = page.getByRole('textbox', { name: 'Search conversations' });
  await expect(search).toBeFocused();
  await expect(designChat).toBeVisible();
  await expect(page.getByRole('button', { name: /^Alex Morgan/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Search all chats' }).click();
  await expect(page.getByRole('button', { name: /^Alex Morgan/ })).toBeVisible();

  await search.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Conversations' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Main menu', exact: true })).toBeFocused();
});

test('formatting dialogs preserve the selected text on cancel and apply', async ({ page }) => {
  await page.goto('/?chat=dev');
  const editor = page.getByRole('textbox', { name: 'Message', exact: true });
  await editor.fill(EDITOR_TEXT);
  await editor.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Edit link', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit link', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'URL', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(editor).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(EDITOR_TEXT);

  await page.getByRole('button', { name: 'Edit link', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'URL', exact: true }).fill(LINK_URL);
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(editor.getByRole('link')).toHaveAttribute('href', LINK_URL);
  await expect(editor.getByRole('link')).toHaveText(EDITOR_TEXT);
  await expect(editor).toBeFocused();
});

test('cancelling image forwarding restores an interactive viewer', async ({ page }) => {
  await page.goto('/?chat=dev');
  await page.getByRole('button', { name: 'Open image: Quiet hills.svg', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'Mia', exact: true });
  await expect(viewer.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  await viewer.getByRole('button', { name: 'Forward', exact: true }).click();

  const forwarding = page.getByRole('dialog', { name: 'Share with', exact: true });
  await expect(forwarding).toBeVisible();
  await forwarding.getByRole('button', { name: 'Close forwarding' }).click();

  await expect(forwarding).toBeHidden();
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(viewer.getByRole('button', { name: 'Reset zoom', exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: 'Close image' }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
});

test('resizing the history preserves the message being read', async ({ page }) => {
  await page.goto('/?chat=lab');
  const history = page.getByLabel('Message history', { exact: true });
  await expect(history).toBeVisible();
  await expect(history.getByRole('group').last()).toContainText('Scroll up to explore');
  await expect
    .poll(() =>
      history.evaluate((viewport) => {
        return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      }),
    )
    .toBeLessThanOrEqual(ANCHOR_TOLERANCE);
  const initialOffset = await history.evaluate((viewport) => viewport.scrollTop);
  await history.hover();
  await page.mouse.wheel(0, HISTORY_SCROLL_DISTANCE);
  await expect
    .poll(() => history.evaluate((viewport) => viewport.scrollTop))
    .toBeLessThan(initialOffset);

  await waitForHistoryLayout(history);
  const anchor = await history.evaluate((viewport) => {
    const viewportTop = viewport.getBoundingClientRect().top;
    const rows = Array.from(viewport.querySelectorAll<HTMLElement>('[data-message-id]'));
    const row = rows.find((candidate) => candidate.getBoundingClientRect().bottom > viewportTop);
    if (!row) {
      throw new Error('No message is visible in the history viewport.');
    }
    return {
      id: row.dataset.messageId!,
      offset: row.getBoundingClientRect().top - viewportTop,
      width: row.getBoundingClientRect().width,
    };
  });

  await page.setViewportSize(RESIZED_VIEWPORT);
  await waitForHistoryLayout(history);
  const anchoredRow = history.locator(`[data-message-id="${anchor.id}"]`);
  await expect(anchoredRow).toBeVisible();
  await expect
    .poll(() => anchoredRow.evaluate((row) => row.getBoundingClientRect().width))
    .toBeLessThan(anchor.width);
  await expect
    .poll(async () => {
      const offset = await anchoredRow.evaluate((row) => {
        const viewport = row.closest('[aria-label="Message history"]')!;
        return row.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      });
      return Math.abs(offset - anchor.offset);
    })
    .toBeLessThanOrEqual(ANCHOR_TOLERANCE);
});
