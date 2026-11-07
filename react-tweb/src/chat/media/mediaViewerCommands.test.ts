import { describe, expect, it } from 'vitest';
import { createHistoryMessages } from '../demo/historyFixtures';
import { getPhotoMessages } from './photoGallery';
import { resolveMediaViewerCommand } from './mediaViewerCommands';

describe('media viewer message commands', () => {
  const album = createHistoryMessages().find((message) => message.media?.kind === 'album')!;
  const selectedPhoto = getPhotoMessages([album])[1];

  it('resolves an album tile to its stored message before deleting or navigating', () => {
    // prettier-ignore
    const parentMessageActions = [
      'delete',
      'go-to-message',
      'edit-caption',
    ] as const;
    for (const action of parentMessageActions) {
      const command = resolveMediaViewerCommand({
        command: { action, message: selectedPhoto },
        messages: [album],
      });

      expect(command?.message).toBe(album);
    }
  });

  it('forwards only the selected album image without duplicating its album', () => {
    const command = resolveMediaViewerCommand({
      command: { action: 'forward', message: selectedPhoto },
      messages: [album],
    });

    expect(command?.message.attachment).toEqual(selectedPhoto.attachment);
    expect(command?.message.media).toBeUndefined();
  });

  it('does not act on a gallery message that was removed from history', () => {
    const command = resolveMediaViewerCommand({
      command: { action: 'delete', message: selectedPhoto },
      messages: [],
    });

    expect(command).toBeUndefined();
  });
});
