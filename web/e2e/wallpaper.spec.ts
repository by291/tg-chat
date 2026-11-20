import { expect, test, type Page } from '@playwright/test';

const SOURCE_WIDTH = 5120;
const SOURCE_HEIGHT = 2560;
const PREPARED_WIDTH = 2560;
const PREPARED_HEIGHT = 1280;
const JPEG_COLOR_TOLERANCE = 4;
// prettier-ignore
const EXPECTED_PIXEL = [
  25,
  118,
  210,
  255,
];

async function openWallpaperSettings(page: Page) {
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'General Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Chat Wallpaper', exact: true }).click();
}

async function readWallpaper(page: Page) {
  const image = page.locator('[aria-hidden="true"] > img[data-blurred]');
  await expect(image).toBeVisible();
  return image.evaluate(async (element: HTMLImageElement) => {
    await element.decode();
    const response = await fetch(element.src);
    const blob = await response.blob();
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('The browser cannot inspect the prepared wallpaper.');
    }
    context.drawImage(element, 0, 0, 1, 1);
    return {
      width: element.naturalWidth,
      height: element.naturalHeight,
      type: blob.type,
      pixel: Array.from(context.getImageData(0, 0, 1, 1).data),
    };
  });
}

async function expectPreparedWallpaper(page: Page) {
  const { pixel, ...metadata } = await readWallpaper(page);
  expect(metadata).toEqual({
    width: PREPARED_WIDTH,
    height: PREPARED_HEIGHT,
    type: 'image/jpeg',
  });
  for (let index = 0; index < EXPECTED_PIXEL.length; index += 1) {
    const difference = Math.abs(pixel[index] - EXPECTED_PIXEL[index]);
    expect(difference).toBeLessThanOrEqual(JPEG_COLOR_TOLERANCE);
  }
}

test('prepares an uploaded wallpaper and restores its encoded image after reload', async ({
  page,
}) => {
  await page.goto('/?chat=dev');
  const pixels = await page.evaluate(
    async ({ width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('The browser cannot create the wallpaper fixture.');
      }
      context.fillStyle = '#1976d2';
      context.fillRect(0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((image) => {
          if (!image) {
            reject(new Error('The browser cannot encode the wallpaper fixture.'));
            return;
          }
          resolve(image);
        }, 'image/png');
      });
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { width: SOURCE_WIDTH, height: SOURCE_HEIGHT },
  );
  await openWallpaperSettings(page);
  await page.getByLabel('Upload wallpaper image').setInputFiles({
    name: 'wallpaper.png',
    mimeType: 'image/png',
    buffer: Buffer.from(pixels),
  });
  await expectPreparedWallpaper(page);

  await page.getByLabel('Upload wallpaper image').setInputFiles({
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.getByText('This image could not be opened.', { exact: true })).toBeVisible();
  await expectPreparedWallpaper(page);

  await page.reload();

  await expectPreparedWallpaper(page);
});
