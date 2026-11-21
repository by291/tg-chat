import { expect, type Locator, type Page } from '@playwright/test';

const HOLD_MS = 750;

interface TextBoundary {
  text: string;
  offset: number;
}

/** Compare native rendered text and clipboard text after the message menu takes focus. */
export async function copyNativeFragment(options: {
  page: Page;
  row: Locator;
  start: TextBoundary;
  end: TextBoundary;
  expected: string;
}) {
  const { page, row, start, end, expected } = options;
  await row.scrollIntoViewIfNeeded();
  await row.focus();
  const selected = await row.evaluate(
    (element, bounds) => {
      function textNode(text: string): Node {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.textContent === text) {
            return node;
          }
        }
        throw new Error(`Missing rendered text: ${text}`);
      }

      const range = new Range();
      range.setStart(textNode(bounds.start.text), bounds.start.offset);
      range.setEnd(textNode(bounds.end.text), bounds.end.offset);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    },
    { start, end },
  );
  expect(selected).toBe(expected);
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
}

/** Hold a message, tap a second message, and copy using only touch input. */
export async function copyMessagesByTouch(options: {
  page: Page;
  first: Locator;
  second: Locator;
  expected: string;
}) {
  const { page, first, second, expected } = options;
  const text = second.locator('[data-message-text]').last();
  await text.scrollIntoViewIfNeeded();
  // Absolute touch coordinates must be sampled after the sliding chat has settled.
  await text.tap({ trial: true });
  const bounds = await text.boundingBox();
  if (!bounds) {
    throw new Error('The second message is outside the viewport.');
  }
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const protocol = await page.context().newCDPSession(page);
  await protocol.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.clock.runFor(HOLD_MS);
  await protocol.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const toolbar = page.getByRole('region', { name: 'Message selection' });
  await expect(toolbar).toContainText('1 message');
  await first.locator('[data-message-text]').last().tap();
  await expect(toolbar).toContainText('2 messages');
  await toolbar.getByRole('button', { name: 'Copy selected messages' }).tap();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
}
