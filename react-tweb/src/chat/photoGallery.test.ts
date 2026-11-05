import { describe, expect, it } from 'vitest';
import { createHistoryMessages } from './historyFixtures';
import { getPhotoMessages } from './photoGallery';

describe('album gallery navigation', () => {
  it('opens repeated album photos at their own positions', () => {
    const album = createHistoryMessages().find((message) => message.media?.kind === 'album')!;
    const photos = getPhotoMessages([album]);
    expect(photos).toHaveLength(3);
    expect(new Set(photos.map((message) => message.id)).size).toBe(3);
    expect(photos[0].attachment?.url).toBe(photos[2].attachment?.url);
  });
});
