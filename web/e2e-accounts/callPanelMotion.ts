import { expect, type Page } from '@playwright/test';

/** Change microphone state during compact entry and check the workspace and playing track. */
export async function verifyInterruptedCallEntry(page: Page) {
  const result = await page.evaluate(async () => {
    const timeoutMs = 2_000;
    const pixelTolerance = 1;
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const getButton = (label: string) =>
      document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]:not([disabled])`);
    const chat = document.querySelector('main[aria-label="Chat"]');
    const video = document.querySelector<HTMLVideoElement>('video[aria-label="Peer camera"]');
    const collapse = getButton('Collapse call panel');
    if (!chat || !video?.srcObject || !collapse) {
      throw new Error('A connected peer camera and workspace are required.');
    }

    const stream = video.srcObject;
    const start = chat.getBoundingClientRect().top;
    collapse.focus();
    collapse.click();

    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      await nextFrame();
      const restore = getButton('Restore call panel');
      const plate = restore?.closest('section');
      const mute = plate?.querySelector<HTMLButtonElement>('button[aria-label="Mute"]');
      if (!plate || !restore || !mute) {
        continue;
      }

      const bounds = plate.getBoundingClientRect();
      const offset = chat.getBoundingClientRect().top - start;
      const isMoving = offset > 0 && offset < bounds.height - pixelTolerance && bounds.top < 0;
      if (!isMoving) {
        continue;
      }

      // This click goes to the current media owner before the plate reaches its final position.
      mute.click();
      await Promise.resolve();
      const hasNewState = mute.disabled || mute.getAttribute('aria-label') === 'Unmute';
      const isStillMoving = plate.getBoundingClientRect().top < 0;

      // Read the original node again after the native layout reaches its destination.
      while (plate.getBoundingClientRect().top < 0 && performance.now() < deadline) {
        await nextFrame();
      }
      const finalBounds = plate.getBoundingClientRect();
      return {
        offset,
        height: bounds.height,
        finalOffset: chat.getBoundingClientRect().top - start,
        finalHeight: finalBounds.height,
        finalTop: finalBounds.top,
        hasNewState,
        isStillMoving,
        hasFocus: document.activeElement === restore,
        hasLiveStream: video.isConnected && video.srcObject === stream,
      };
    }

    throw new Error('The workspace never moved through an intermediate call bar position.');
  });

  expect(result.hasNewState).toBe(true);
  expect(result.isStillMoving).toBe(true);
  expect(result.finalTop).toBe(0);
  expect(result.finalOffset).toBe(result.finalHeight);
  expect(result.hasFocus).toBe(true);
  expect(result.hasLiveStream).toBe(true);
  const compact = page.getByRole('region', { name: 'Call', exact: true });
  await expect(compact.getByRole('button', { name: 'Unmute' })).toBeEnabled();
  await expect(compact.getByRole('button', { name: 'Hang up' })).toBeEnabled();
  await expect.poll(() => compact.evaluate((plate) => plate.getBoundingClientRect().top)).toBe(0);
  return result;
}
