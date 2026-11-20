// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  discardWallpaperImage,
  prepareWallpaperImage,
  readWallpaperImage,
  saveWallpaperImage,
} from './wallpaperImages';

const SOURCE_WIDTH = 5120;
const SOURCE_HEIGHT = 2560;
const OVERSIZED_FILE_BYTES = 21 * 1024 * 1024;
const encodedImage = new NodeBlob(['prepared wallpaper'], { type: 'image/jpeg' });

let bitmap: ImageBitmap;
let preparedCanvas: HTMLCanvasElement | undefined;

function imageFile() {
  return new File(['source image'], 'wallpaper.png', { type: 'image/png' });
}

beforeEach(() => {
  bitmap = {
    width: SOURCE_WIDTH,
    height: SOURCE_HEIGHT,
    close: vi.fn(),
  } as unknown as ImageBitmap;
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  const context = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
  ) {
    preparedCanvas = this;
    callback(encodedImage as unknown as Blob);
  });
  preparedCanvas = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('rejects non-image uploads before trying to decode them', async () => {
  const file = new File(['document'], 'notes.txt', { type: 'text/plain' });

  await expect(prepareWallpaperImage(file)).rejects.toThrow('Choose a JPEG, PNG, or WebP image.');
  expect(createImageBitmap).not.toHaveBeenCalled();
});

it('rejects oversized images before allocating decoded pixels', async () => {
  const file = imageFile();
  Object.defineProperty(file, 'size', { value: OVERSIZED_FILE_BYTES });

  await expect(prepareWallpaperImage(file)).rejects.toThrow('Choose an image smaller than 20 MB.');
  expect(createImageBitmap).not.toHaveBeenCalled();
});

it('reports a decoder rejection as unreadable image contents', async () => {
  vi.mocked(createImageBitmap).mockRejectedValue(
    new DOMException('Invalid image', 'InvalidStateError'),
  );

  await expect(prepareWallpaperImage(imageFile())).rejects.toThrow(
    'This image could not be opened.',
  );
});

it('bounds decoded dimensions while preserving the aspect ratio and releases the bitmap', async () => {
  const prepared = await prepareWallpaperImage(imageFile());

  expect(preparedCanvas?.width).toBe(2560);
  expect(preparedCanvas?.height).toBe(1280);
  expect(prepared.type).toBe('image/jpeg');
  expect(bitmap.close).toHaveBeenCalledOnce();
});

it('keeps a smaller image at its original size', async () => {
  vi.mocked(createImageBitmap).mockResolvedValue({ ...bitmap, width: 640, height: 480 });

  await prepareWallpaperImage(imageFile());

  expect(preparedCanvas?.width).toBe(640);
  expect(preparedCanvas?.height).toBe(480);
});

it('releases decoded pixels when the browser cannot encode the canvas', async () => {
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => callback(null));

  await expect(prepareWallpaperImage(imageFile())).rejects.toThrow(
    'This image could not be processed.',
  );
  expect(bitmap.close).toHaveBeenCalledOnce();
});

it('persists prepared bytes and removes discarded images from IndexedDB', async () => {
  const imageId = await saveWallpaperImage(imageFile());
  const stored = await readWallpaperImage(imageId);

  expect(stored?.type).toBe('image/jpeg');
  expect(await stored?.text()).toBe('prepared wallpaper');

  await discardWallpaperImage(imageId);

  expect(await readWallpaperImage(imageId)).toBeUndefined();
});

it('reports storage rejection after releasing decoded pixels', async () => {
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
  });

  await expect(saveWallpaperImage(imageFile())).rejects.toThrow('Could not save this wallpaper.');
  expect(bitmap.close).toHaveBeenCalledOnce();
});
