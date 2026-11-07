import type { Message } from '../model';
import { getGalleryMessages } from './photoGallery';

export interface MediaViewerCommand {
  action: 'forward' | 'delete' | 'go-to-message' | 'edit-caption';
  message: Message;
}

interface ResolveMediaViewerCommandOptions {
  command: MediaViewerCommand;
  messages: Message[];
}

/** Resolve synthetic album tiles against current history before acting on their parent. */
export function resolveMediaViewerCommand({
  command,
  messages,
}: ResolveMediaViewerCommandOptions): MediaViewerCommand | undefined {
  const sourceMessage = messages.find((candidate) => {
    if (candidate.chatId !== command.message.chatId) {
      return false;
    }
    return getGalleryMessages([candidate]).some((entry) => entry.id === command.message.id);
  });
  if (!sourceMessage) {
    return undefined;
  }

  const isForwardingAlbumPhoto =
    command.action === 'forward' && sourceMessage.media?.kind === 'album';
  if (isForwardingAlbumPhoto) {
    const selectedPhoto = getGalleryMessages([sourceMessage]).find((entry) => {
      return entry.id === command.message.id;
    });
    // Gallery tiles retain the album for navigation, but forwarding sends only this image.
    return { ...command, message: { ...selectedPhoto!, media: undefined } };
  }

  return { ...command, message: sourceMessage };
}
