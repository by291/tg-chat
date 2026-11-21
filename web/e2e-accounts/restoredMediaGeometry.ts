import { expect, type Locator, type Page } from '@playwright/test';

const FRAME_DECIMAL_PRECISION = 1;
const SERVER_PROCESSING_TIMEOUT_MS = 30_000;
const PORTRAIT = {
  filename: 'portrait.png',
  width: 600,
  height: 1200,
};
const WIDE = {
  filename: 'wide.png',
  width: 1600,
  height: 800,
};
const NARROW = {
  filename: 'narrow.png',
  width: 200,
  height: 600,
};
const FILE_GROUPS = [[PORTRAIT], [WIDE, NARROW]];

interface MediaFrame {
  width: number;
  height: number;
}

/** Compare the unrounded sizes of the same tile across ownership changes. */
export function expectMatchingFrame(actual: MediaFrame, expected: MediaFrame) {
  expect(actual.width).toBeCloseTo(expected.width, FRAME_DECIMAL_PRECISION);
  expect(actual.height).toBeCloseTo(expected.height, FRAME_DECIMAL_PRECISION);
}

/** Encode a PNG with known intrinsic dimensions through the browser canvas. */
export async function createPhoto(page: Page, source: typeof PORTRAIT) {
  const encoded = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const encodedPhoto = canvas.toDataURL('image/png');
    return encodedPhoto.split(',')[1];
  }, source);

  return {
    name: source.filename,
    mimeType: 'image/png',
    buffer: Buffer.from(encoded, 'base64'),
  };
}

/** Observe the pending tile's first layout before a later preview decode can change it. */
function observeAdmission(page: Page, filenames: string[]) {
  return page.evaluateHandle((names) => {
    const frames = new Map<string, MediaFrame>();
    const observer = new MutationObserver(() => {
      const tiles = document.querySelectorAll('article [role="group"][aria-label]');
      for (const tile of tiles) {
        const name = tile.getAttribute('aria-label');
        if (!name || !names.includes(name) || frames.has(name)) {
          continue;
        }
        const style = getComputedStyle(tile);
        frames.set(name, { width: parseFloat(style.width), height: parseFloat(style.height) });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return { frames, observer };
  }, filenames);
}

async function hasMeasuredPreview(dialog: Locator) {
  const wide = await dialog.getByRole('img', { name: WIDE.filename }).boundingBox();
  const narrow = await dialog.getByRole('img', { name: NARROW.filename }).boundingBox();
  if (!wide || !narrow) {
    return false;
  }
  return wide.width / wide.height > narrow.width / narrow.height;
}

async function verifyFirstFrame(options: {
  page: Page;
  filename: string;
  admission: Awaited<ReturnType<typeof observeAdmission>>;
}) {
  const { page, filename, admission } = options;
  const pending = page.getByRole('group', {
    name: filename,
    exact: true,
  });
  await expect(pending).toBeVisible();
  const first = await admission.evaluate((record, name) => record.frames.get(name), filename);
  const settled = await pending.boundingBox();
  if (!first || !settled) {
    throw new Error('Expected a visible tile from the first pending layout.');
  }
  expectMatchingFrame(first, settled);
}

/** Send measured photos and compare the first pending frame with its settled size. */
export async function selectMeasuredMedia(page: Page) {
  for (const group of FILE_GROUPS) {
    await page.getByRole('button', { name: 'Attach', exact: true }).click();
    const chooserEvent = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Photo or Video' }).click();
    const chooser = await chooserEvent;
    const files = await Promise.all(group.map((source) => createPhoto(page, source)));
    await chooser.setFiles(files);

    const dialog = page.getByRole('dialog', { name: 'Send attachments' });
    const send = dialog.getByRole('button', { name: 'Send attachments' });
    await expect(send).toBeEnabled();
    if (group.length > 1) {
      // Intrinsic measurement can finish after Send enables and before the first admitted tile.
      await expect.poll(() => hasMeasuredPreview(dialog)).toBe(true);
    }

    const admission = await observeAdmission(
      page,
      group.map((source) => source.filename),
    );
    try {
      await send.click();
      await expect(dialog).toHaveCount(0);
      for (const source of group) {
        await verifyFirstFrame({
          page,
          filename: source.filename,
          admission,
        });
      }
    } finally {
      await admission.evaluate((record) => record.observer.disconnect());
      await admission.dispose();
    }
  }
}

/** Measure the actual rendered rectangles at each stage of durable upload reconciliation. */
export async function measureMediaFrames(page: Page, stage: 'pending' | 'accepted') {
  const frames: MediaFrame[] = [];
  for (const file of FILE_GROUPS.flat()) {
    const tile =
      stage === 'pending'
        ? page.getByRole('group', { name: file.filename, exact: true })
        : page.getByRole('button', { name: new RegExp(`Open.*${file.filename}`) });
    await expect(tile).toBeVisible({ timeout: SERVER_PROCESSING_TIMEOUT_MS });
    const bounds = await tile.boundingBox();
    if (!bounds) {
      throw new Error(`No visible media frame for ${file.filename}`);
    }
    frames.push({ width: bounds.width, height: bounds.height });
  }
  return frames;
}
