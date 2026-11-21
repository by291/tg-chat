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

const PHOTO_ROW = '[data-message-id="dev-4"]';
const WHEEL_RELEASE_MS = 75;
const WHEEL_DISTANCE = 272;
const CLOCK_START = new Date('2026-11-01T12:00:00Z');
const CLOCK_PAUSE = new Date('2026-11-01T12:00:01Z');

test.describe('gallery thumbnail gestures', () => {
  // prettier-ignore
  test.use({
    viewport: TOUCH_VIEWPORT,
    isMobile: true,
    hasTouch: true,
  });

  test('swipes the photo to reply and retains tap to open the gallery', async ({
    page,
    context,
  }) => {
    await page.goto('/?chat=dev');
    const row = page.locator(PHOTO_ROW);
    const photo = row.locator('button[data-photo-id]');
    const protocol = await context.newCDPSession(page);
    // A drag on the reaction belongs to that button; it must never act on the gallery row.
    const reaction = row.getByRole('button', { name: /reaction$/ });
    const controlOrigin = await startSwipe(protocol, reaction);
    await moveSwipe({ protocol, origin: controlOrigin, distance: { x: -SWIPE_DISTANCE, y: 0 } });
    await protocol.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('button', { name: 'Jump to replied message' })).toHaveCount(0);
    const origin = await startSwipe(protocol, photo);
    await moveSwipe({ protocol, origin, distance: { x: -SWIPE_DISTANCE, y: 0 } });
    await expect(row).toHaveAttribute('data-reply-swiping', 'true');
    await protocol.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('button', { name: 'Jump to replied message' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await photo.tap();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});

test('horizontal trackpad motion moves the photo and its avatar until release', async ({
  page,
}) => {
  await page.goto('/?chat=dev');
  const row = page.locator(PHOTO_ROW);
  const photo = row.locator('[data-photo-id]');
  const avatar = page.locator('[data-sender-group="dev-4"] > :first-child');
  const reply = page.getByRole('button', { name: 'Jump to replied message' });
  await photo.hover();
  await page.clock.install({ time: CLOCK_START });
  await page.clock.pauseAt(CLOCK_PAUSE);
  await page.mouse.wheel(WHEEL_DISTANCE, 0);
  await expect(row).toHaveAttribute('data-reply-swiping', 'true');
  await expect(row.locator('[data-message-row-content]')).toHaveCSS('translate', '-64px');
  await expect(avatar).toHaveCSS('translate', '-64px');
  await expect(reply).toHaveCount(0);
  await page.clock.runFor(WHEEL_RELEASE_MS);
  await expect(reply).toBeVisible();
  await expect(row.locator('[data-message-row-content]')).toHaveCSS('transition-duration', '0.25s');
});

test('reduced motion keeps the reply feedback stationary and accepts the threshold', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?chat=dev');
  const row = page.locator(PHOTO_ROW);
  const photo = row.locator('[data-photo-id]');
  const avatar = page.locator('[data-sender-group="dev-4"] > :first-child');
  const content = row.locator('[data-message-row-content]');
  const reply = page.getByRole('button', { name: 'Jump to replied message' });
  await photo.hover();
  await page.clock.install({ time: CLOCK_START });
  await page.clock.pauseAt(CLOCK_PAUSE);

  // The first burst ends one CSS pixel below threshold. The next reaches it exactly.
  const belowThreshold = 188;
  const atThreshold = 192;
  await page.mouse.wheel(belowThreshold, 0);
  await expect(row).toHaveAttribute('data-reply-swiping', 'true');
  await page.clock.runFor(WHEEL_RELEASE_MS);
  await expect(reply).toHaveCount(0);

  await page.mouse.wheel(atThreshold, 0);
  await expect(row).toHaveAttribute('data-reply-swiping', 'true');
  await expect(content).toHaveCSS('translate', 'none');
  await expect(avatar).toHaveCSS('translate', 'none');
  await expect(content).toHaveCSS('transition-property', 'none');
  await page.clock.runFor(WHEEL_RELEASE_MS);
  await expect(reply).toBeVisible();
});
