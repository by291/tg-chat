import { describe, expect, it } from 'vitest';
import { createHistoryMessages } from '@/features/chat/demo/historyFixtures';
import { getGalleryMessages, getPhotoMessages } from './photoGallery';

describe('album gallery navigation', () => {
  it('opens repeated album photos at their own positions', () => {
    const album = createHistoryMessages().find((message) => message.media?.kind === 'album')!;
    const photos = getPhotoMessages([album]);
    expect(photos).toHaveLength(3);
    expect(new Set(photos.map((message) => message.id)).size).toBe(3);
    expect(photos[0].attachment?.url).toBe(photos[2].attachment?.url);
  });
});

describe('mixed media gallery navigation', () => {
  it('includes ordinary videos between photos and excludes round video messages', () => {
    const messages = createHistoryMessages();
    const video = messages.find((message) => message.media?.kind === 'video')!;
    const album = messages.find((message) => message.media?.kind === 'album')!;
    if (video.media?.kind !== 'video') {
      throw new Error('Expected a video fixture.');
    }

    const ordinaryVideo = {
      ...video,
      id: 'ordinary-video',
      media: {
        ...video.media,
        isRound: false,
      },
    };
    const roundVideo = {
      ...ordinaryVideo,
      id: 'round-video',
      media: { ...ordinaryVideo.media, isRound: true },
    };
    // prettier-ignore
    const mixedMediaMessages = [
      ordinaryVideo,
      roundVideo,
      album,
    ];
    const gallery = getGalleryMessages(mixedMediaMessages);
    expect(gallery.map((message) => message.id)).toEqual([
      'ordinary-video',
      `${album.id}:photo:0`,
      `${album.id}:photo:1`,
      `${album.id}:photo:2`,
    ]);
    expect(getPhotoMessages([ordinaryVideo, roundVideo])).toEqual([]);
  });
});
