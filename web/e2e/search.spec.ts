import { expect, test } from '@playwright/test';

const CALENDAR_NOW = new Date('2026-11-08T12:00:00');
const SEARCH_STEPS = 12;
const WIDE_VIEWPORT = { width: 1600, height: 1000 };
const NARROW_VIEWPORT = { width: 390, height: 844 };

test('narrow search switches between the result list and the located conversation', async ({
  page,
}) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  await page.goto('/?chat=lab');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Draft before searching');
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('menuitem', { name: 'Search', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search in this conversation' });
  const results = page.getByRole('region', { name: 'Search results' });
  const position = page.getByRole('status', { name: 'Search position' });
  const highlight = page.locator('article[data-highlighted="true"]');

  await search.fill('Archive note 100');
  await expect(results).toBeVisible();
  await expect(composer).toBeHidden();
  await expect(position).toHaveText('2 results');
  await results.getByRole('button', { name: /Archive note 1000:/ }).click();

  await expect(results).toBeHidden();
  await expect(search).toHaveValue('Archive note 100');
  await expect(highlight).toContainText('Archive note 1000:');
  const next = page.getByRole('button', { name: 'Next search result' });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(position).toHaveText('2 of 2');
  await expect(position).toBeInViewport();
  await expect(highlight).toContainText('Archive note 100:');

  await page.getByRole('button', { name: 'Show search results' }).click();
  await expect(results).toBeVisible();
  await expect(results.getByRole('button', { name: /Archive note 100:/ })).toBeVisible();
  await page.getByRole('button', { name: 'Show in chat' }).click();
  await expect(results).toBeHidden();
  await expect(position).toHaveText('2 of 2');
  await page.getByRole('button', { name: 'Close search', exact: true }).click();
  await expect(composer).toHaveText('Draft before searching');
});

test('search keeps keyboard navigation active until the highlighted result is confirmed', async ({
  page,
}) => {
  await page.goto('/?chat=lab');
  const trigger = page.getByRole('button', { name: 'Search messages', exact: true });
  await trigger.click();
  const search = page.getByRole('textbox', { name: 'Search in this conversation' });
  await search.fill('Archive note');

  for (let index = 0; index < SEARCH_STEPS; index += 1) {
    await search.press('ArrowDown');
    await expect(search).toBeFocused();
  }

  const results = page.getByRole('region', { name: 'Search results' });
  const highlighted = results.locator('button[data-active="true"]');

  await expect(highlighted).toBeInViewport();

  const highlightedText = await highlighted.innerText();
  await search.press('ArrowUp');

  await expect(highlighted).not.toHaveText(highlightedText);

  await search.press('Enter');

  await expect(search).not.toBeFocused();
  await expect(highlighted).not.toBeInViewport();

  await page.keyboard.press('Escape');

  await expect(search).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('search can reopen and close while its previous exit animation is still running', async ({
  page,
}) => {
  await page.goto('/?chat=dev');
  const trigger = page.getByRole('button', { name: 'Search messages', exact: true });
  await trigger.click();
  const search = page.getByRole('textbox', { name: 'Search in this conversation' });
  await search.press('Escape');
  await trigger.press('Enter');

  await expect(search).toBeFocused();

  await search.press('Escape');

  await expect(search).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('composition keys do not navigate, confirm, or dismiss conversation search', async ({
  page,
}) => {
  await page.goto('/?chat=lab');
  await page.getByRole('button', { name: 'Search messages', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search in this conversation' });
  await search.fill('Archive note');
  // prettier-ignore
  const compositionKeys = [
    'ArrowDown',
    'Enter',
    'Escape',
  ];
  const results = page.getByRole('region', { name: 'Search results' });

  for (const key of compositionKeys) {
    await search.dispatchEvent('keydown', { key, isComposing: true });
    await expect(search).toBeFocused();
    await expect(results.locator('button[data-active="true"]')).toHaveCount(0);
  }

  await search.press('Escape');

  await expect(search).toBeVisible();
  await expect(search).not.toBeFocused();

  await page.keyboard.press('Escape');

  await expect(search).toBeHidden();
});

test('calendar mounts and focuses keyboard targets across months and years', async ({ page }) => {
  await page.clock.setFixedTime(CALENDAR_NOW);
  await page.goto('/?chat=dev');
  await page.getByRole('button', { name: 'Search messages', exact: true }).click();
  await page.getByRole('button', { name: 'Jump to date', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const today = dialog.getByRole('button', { name: 'Sunday, November 8, 2026', exact: true });
  await today.focus();
  await today.press('PageUp');
  const october = dialog.getByRole('button', { name: 'Thursday, October 8, 2026', exact: true });

  await expect(october).toBeFocused();
  await expect(october).toBeInViewport();

  await october.press('Shift+PageUp');
  const previousYear = dialog.getByRole('button', {
    name: 'Wednesday, October 8, 2025',
    exact: true,
  });

  await expect(previousYear).toBeFocused();
  await expect(previousYear).toBeInViewport();

  await previousYear.press('Shift+PageDown');

  await expect(october).toBeFocused();

  await october.press('PageDown');

  await expect(today).toBeFocused();

  await today.press('ArrowRight');

  await expect(today).toBeFocused();

  const firstNovember = dialog.getByRole('button', {
    name: 'Sunday, November 1, 2026',
    exact: true,
  });
  await firstNovember.focus();
  await firstNovember.press('ArrowLeft');
  const lastOctober = dialog.getByRole('button', {
    name: 'Saturday, October 31, 2026',
    exact: true,
  });

  await expect(lastOctober).toBeFocused();
  await expect(lastOctober).toBeInViewport();

  await lastOctober.press('Enter');

  await expect(lastOctober).toHaveAttribute('data-selected');
});

test('calendar scrolling preserves control focus and Escape only closes the top layer', async ({
  page,
}) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await page.clock.setFixedTime(CALENDAR_NOW);
  await page.goto('/?chat=dev');
  await page.getByRole('button', { name: 'Open chat information' }).click();
  await page.getByRole('button', { name: 'Search messages', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search in this conversation' });
  const dateTrigger = page.getByRole('button', { name: 'Jump to date', exact: true });
  await dateTrigger.click();
  const dialog = page.getByRole('dialog');
  const closeCalendar = dialog.getByRole('button', { name: 'Close date picker' });

  await expect(closeCalendar).toBeFocused();

  await dialog.getByLabel('Calendar months').evaluate((viewport) => {
    viewport.scrollTop = 0;
  });
  const earliest = dialog.getByRole('button', { name: 'Thursday, August 1, 2013', exact: true });

  await expect(earliest).toBeVisible();
  await expect(closeCalendar).toBeFocused();

  await earliest.focus();
  await earliest.press('ArrowLeft');

  await expect(earliest).toBeFocused();

  await earliest.press('Escape');

  await expect(dialog).toBeHidden();
  await expect(search).toBeVisible();
  await expect(dateTrigger).toBeFocused();
  await expect(page.getByRole('button', { name: 'Close chat information' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(search).toBeHidden();
  await expect(page.getByRole('button', { name: 'Close chat information' })).toBeVisible();
});
