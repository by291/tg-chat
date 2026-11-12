import { expect, test, type CDPSession, type Locator } from '@playwright/test';

const TOUCH_VIEWPORT = { width: 390, height: 844 };
const SWIPE_DISTANCE = 70;
const SHORT_SWIPE_DISTANCE = 25;

interface Point {
  x: number;
  y: number;
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

test('only a completed horizontal swipe adds a reply', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: TOUCH_VIEWPORT,
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    const protocol = await context.newCDPSession(page);
    await page.goto('/?chat=lab');

    const history = page.getByLabel('Message history', { exact: true });
    const row = history.getByRole('group', { name: /^Message: Scroll up to explore/ });
    const text = row.locator('[data-message-text]').last();
    const reply = page.getByRole('button', { name: 'Jump to replied message' });
    const menu = page.getByRole('menu', { name: 'Message actions' });
    await expect(text).toBeInViewport();

    const initialOffset = await history.evaluate((viewport) => viewport.scrollTop);
    const verticalOrigin = await startSwipe(protocol, text);
    await moveSwipe({
      protocol,
      origin: verticalOrigin,
      distance: { x: 0, y: SWIPE_DISTANCE },
    });
    await protocol.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(() => history.evaluate((viewport) => viewport.scrollTop))
      .toBeLessThan(initialOffset);
    await expect(reply).toHaveCount(0);

    const shortOrigin = await startSwipe(protocol, text);
    await moveSwipe({
      protocol,
      origin: shortOrigin,
      distance: { x: -SHORT_SWIPE_DISTANCE, y: 0 },
    });
    await protocol.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(reply).toHaveCount(0);
    await expect(menu).toHaveCount(0);

    const horizontalDistance = { x: -SWIPE_DISTANCE, y: 0 };
    const cancelledOrigin = await startSwipe(protocol, text);
    await moveSwipe({ protocol, origin: cancelledOrigin, distance: horizontalDistance });
    await protocol.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(reply).toHaveCount(0);

    const horizontalOrigin = await startSwipe(protocol, text);
    await moveSwipe({ protocol, origin: horizontalOrigin, distance: horizontalDistance });
    await expect(reply).toHaveCount(0);
    await protocol.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    await expect(reply).toContainText('Scroll up to explore');
    await expect(menu).toHaveCount(0);
  } finally {
    await context.close();
  }
});
