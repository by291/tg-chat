import { expect, type Page } from '@playwright/test';

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

/** Queue fresh images through the picker so reload exercises the dimensions captured by the UI. */
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
      const wide = await dialog.getByRole('img', { name: WIDE.filename }).boundingBox();
      const narrow = await dialog.getByRole('img', { name: NARROW.filename }).boundingBox();
      if (!wide || !narrow) {
        throw new Error('Both selected album images must have visible frames.');
      }
      expect(wide.width).toBeGreaterThan(narrow.width);
    }

    await send.click();
    await expect(dialog).toHaveCount(0);
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
    frames.push({ width: Math.round(bounds.width), height: Math.round(bounds.height) });
  }
  return frames;
}
