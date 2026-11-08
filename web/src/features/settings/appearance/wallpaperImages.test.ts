// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { prepareWallpaperImage } from './wallpaperImages';

it('rejects non-image uploads before trying to decode them', async () => {
  const file = new File(['document'], 'notes.txt', { type: 'text/plain' });

  await expect(prepareWallpaperImage(file)).rejects.toThrow('Choose a JPEG, PNG, or WebP image.');
});

it('rejects unreadable image contents without changing the current wallpaper', async () => {
  const file = new File(['broken'], 'broken.png', { type: 'image/png' });

  await expect(prepareWallpaperImage(file)).rejects.toThrow('This image could not be opened.');
});
