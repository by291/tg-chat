// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { acquireWallpaperImage, getPreparedWallpaperUrl } from './wallpaperImageResources';
import { readWallpaperImage } from './wallpaperImages';

vi.mock('./wallpaperImages', () => ({ readWallpaperImage: vi.fn() }));

beforeEach(() => {
  vi.mocked(readWallpaperImage).mockResolvedValue(new Blob(['image']));
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decode = () => Promise.resolve();
    },
  );
  URL.createObjectURL = vi.fn(() => 'blob:wallpaper');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('keeps a decoded image alive until both the transition and visible wallpaper release it', async () => {
  const transition = acquireWallpaperImage('shared-image');
  await transition.ready;
  const visible = acquireWallpaperImage('shared-image');
  await visible.ready;
  transition.release();

  expect(getPreparedWallpaperUrl('shared-image')).toBe('blob:wallpaper');
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();

  visible.release();

  expect(getPreparedWallpaperUrl('shared-image')).toBeUndefined();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:wallpaper');
});

it('releases decoded bytes when the requesting view disappears before loading finishes', async () => {
  let complete!: (blob: Blob) => void;
  vi.mocked(readWallpaperImage).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const request = acquireWallpaperImage('cancelled-image');
  request.release();
  complete(new Blob(['image']));
  await request.ready;

  expect(getPreparedWallpaperUrl('cancelled-image')).toBeUndefined();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:wallpaper');
});

it('does not publish an image whose decoding fails', async () => {
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decode = () => Promise.reject(new Error('Invalid image'));
    },
  );
  const request = acquireWallpaperImage('broken-image');

  await expect(request.ready).rejects.toThrow('Invalid image');

  request.release();

  expect(getPreparedWallpaperUrl('broken-image')).toBeUndefined();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:wallpaper');
});
