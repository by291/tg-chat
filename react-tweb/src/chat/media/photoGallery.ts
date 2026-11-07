import type { Message } from '../model';
import type { PhotoAttachment } from '../messageMedia';

/** Give each album tile its own gallery identity, including repeated images. */
export function createAlbumPhoto(
  message: Message,
  attachment: PhotoAttachment,
  index: number,
): Message {
  return {
    ...message,
    id: `${message.id}:photo:${index}`,
    attachment,
  };
}

/** Flatten album photos into the same navigation sequence as standalone photos. */
export function getPhotoMessages(messages: Message[]): Message[] {
  const photos: Message[] = [];
  for (const message of messages) {
    if (message.attachment) {
      photos.push(message);
      continue;
    }
    if (message.media?.kind === 'album') {
      for (let index = 0; index < message.media.photos.length; index += 1) {
        photos.push(createAlbumPhoto(message, message.media.photos[index], index));
      }
    }
  }
  return photos;
}

/** Keep photos and ordinary videos in history order while round videos play in place. */
export function getGalleryMessages(messages: Message[]): Message[] {
  return messages.flatMap((message) => {
    if (message.media?.kind === 'video' && !message.media.isRound) {
      return [message];
    }
    return getPhotoMessages([message]);
  });
}
