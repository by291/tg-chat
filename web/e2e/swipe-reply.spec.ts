import { expect, test, type CDPSession, type Locator } from '@playwright/test';
import { waitForHistoryLayout } from './historyViewport';

const TOUCH_VIEWPORT = { width: 390, height: 844 };
const SWIPE_DISTANCE = 70;
const SHORT_SWIPE_DISTANCE = 25;

interface Point {
  x: number;
  y: number;
}

interface SwipeFixture {
  protocol: CDPSession;
  history: Locator;
  row: Locator;
  text: Locator;
  reply: Locator;
}

async function startSwipe(protocol: CDPSession, target: Locator): Promise<Point> {
  await target.scrollIntoViewIfNeeded();
  const bounds = await target.boundingBox();
  if (!bounds) {
    throw new Error('The swipe target is not visible.');
  }

  const origin = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await protocol.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [origin] });
  return origin;
}

async function moveSwipe(options: { protocol: CDPSession; origin: Point; distance: Point }) {
  const { protocol, origin, distance } = options;
  await protocol.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: origin.x + distance.x, y: origin.y + distance.y }],
  });
}

const swipeTest = test.extend<{ swipe: SwipeFixture }>({
  swipe: async ({ page, context }, use) => {
    const protocol = await context.newCDPSession(page);
    await page.goto('/?chat=lab');

    const history = page.getByLabel('Message history', { exact: true });
    const row = history.getByRole('group', { name: /^Message: Scroll up to explore/ });
    const text = row.locator('[data-message-text]').last();
    const reply = page.getByRole('button', { name: 'Jump to replied message' });
    await expect(text).toBeInViewport();
    await waitForHistoryLayout(history);

    await use({
      protocol,
      history,
      row,
      text,
      reply,
    });
  },
});

swipeTest.use({
  viewport: TOUCH_VIEWPORT,
  isMobile: true,
  hasTouch: true,
});

// A separate page keeps native scroll momentum from moving subsequent horizontal targets.
swipeTest('a vertical swipe scrolls history without adding a reply', async ({ swipe }) => {
  const { protocol, history, text, reply } = swipe;
  const initialOffset = await history.evaluate((viewport) => viewport.scrollTop);
  const origin = await startSwipe(protocol, text);
  await moveSwipe({ protocol, origin, distance: { x: 0, y: SWIPE_DISTANCE } });
  await protocol.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect
    .poll(() => history.evaluate((viewport) => viewport.scrollTop))
    .toBeLessThan(initialOffset);
  await expect(reply).toHaveCount(0);
});

swipeTest('only a completed horizontal swipe adds a reply', async ({ page, swipe }) => {
  const { protocol, row, text, reply } = swipe;
  const menu = page.getByRole('menu', { name: 'Message actions' });
  const shortOrigin = await startSwipe(protocol, text);
  await moveSwipe({ protocol, origin: shortOrigin, distance: { x: -SHORT_SWIPE_DISTANCE, y: 0 } });
  await expect(row).toHaveAttribute('data-reply-swiping', 'true');
  await protocol.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(reply).toHaveCount(0);
  await expect(menu).toHaveCount(0);

  const horizontalDistance = { x: -SWIPE_DISTANCE, y: 0 };
  const cancelledOrigin = await startSwipe(protocol, text);
  await moveSwipe({ protocol, origin: cancelledOrigin, distance: horizontalDistance });
  await expect(row).toHaveAttribute('data-reply-swiping', 'true');
  await protocol.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(row).not.toHaveAttribute('data-reply-swiping', 'true');
  await expect(reply).toHaveCount(0);

  const horizontalOrigin = await startSwipe(protocol, text);
  await moveSwipe({ protocol, origin: horizontalOrigin, distance: horizontalDistance });
  await expect(row).toHaveAttribute('data-reply-swiping', 'true');
  await expect(reply).toHaveCount(0);
  await protocol.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(reply).toContainText('Scroll up to explore');
  await expect(menu).toHaveCount(0);
});
